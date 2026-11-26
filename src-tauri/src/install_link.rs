use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use tauri::{AppHandle, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use url::Url;

use crate::{append_desktop_log, BackendState, DEFAULT_SHELL_LOCALE};

#[derive(Debug, PartialEq, Eq)]
struct InstallTarget {
    plugin_id: String,
    registry_url: Option<String>,
}

fn parse_target(value: &str) -> Option<InstallTarget> {
    let url = Url::parse(value).ok()?;
    if url.scheme() != "astrbot"
        || url.host_str() != Some("extension")
        || url.path() != "/plugins"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    let mut plugin_id = None;
    let mut registry_url = None;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "market_plugin_id" if plugin_id.is_none() => plugin_id = Some(value.into_owned()),
            "registry_url" if registry_url.is_none() => {
                let registry = Url::parse(&value).ok()?;
                if registry.scheme() != "https"
                    || registry.host_str().is_none()
                    || !registry.username().is_empty()
                    || registry.password().is_some()
                    || registry.fragment().is_some()
                {
                    return None;
                }
                registry_url = Some(registry.to_string());
            }
            _ => return None,
        }
    }
    let plugin_id = plugin_id?;
    let (author, name) = plugin_id.split_once('/')?;
    if author.is_empty()
        || name.is_empty()
        || name.contains('/')
        || author.trim() != author
        || name.trim() != name
        || plugin_id.chars().any(char::is_control)
    {
        return None;
    }

    Some(InstallTarget {
        plugin_id,
        registry_url,
    })
}

impl InstallTarget {
    fn fragment(&self) -> String {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        query.append_pair("market_plugin_id", &self.plugin_id);
        if let Some(registry) = &self.registry_url {
            query.append_pair("registry_url", registry);
        }
        format!("/extension/plugins?{}", query.finish())
    }
}

#[derive(Default)]
pub(crate) struct InstallLinkState {
    pending: Mutex<Option<String>>,
    ready: AtomicBool,
}

pub(crate) fn setup(app: &tauri::App) {
    #[cfg(target_os = "linux")]
    if let Err(error) = app.deep_link().register_all() {
        append_desktop_log(&format!(
            "could not register plugin installation links: {error}"
        ));
    }
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            receive(&handle, url.as_str());
        }
    });
    match app.deep_link().get_current() {
        Ok(Some(urls)) => {
            for url in urls {
                receive(app.handle(), url.as_str());
            }
        }
        Ok(None) => {}
        Err(error) => append_desktop_log(&format!(
            "could not read the initial plugin installation link: {error}"
        )),
    }
}

fn receive(app: &AppHandle, value: &str) {
    let Some(target) = parse_target(value) else {
        append_desktop_log("ignored an invalid plugin installation link");
        return;
    };
    let fragment = target.fragment();
    let result = crate::ui_dispatch::run_on_main_thread_dispatch(
        app,
        "open plugin installation link",
        move |app| {
            let state = app.state::<InstallLinkState>();
            *state.pending.lock().unwrap() = Some(fragment);
            crate::window::actions::show_main_window(app, DEFAULT_SHELL_LOCALE, append_desktop_log);
            resume_pending(app);
        },
    );
    if let Err(error) = result {
        append_desktop_log(&error);
    }
}

pub(crate) fn page_started(app: &AppHandle) {
    app.state::<InstallLinkState>()
        .ready
        .store(false, Ordering::SeqCst);
}

pub(crate) fn dashboard_ready(app: &AppHandle) {
    app.state::<InstallLinkState>()
        .ready
        .store(true, Ordering::SeqCst);
    resume_pending(app);
}

#[derive(Debug, PartialEq, Eq)]
enum PendingAction {
    Wait,
    Open,
    StartBackend,
}

fn pending_action(ready: bool, startup_failed: bool, running: bool, busy: bool) -> PendingAction {
    if busy || (!ready && !startup_failed) {
        PendingAction::Wait
    } else if ready && running {
        PendingAction::Open
    } else {
        PendingAction::StartBackend
    }
}

pub(crate) fn resume_pending(app: &AppHandle) {
    let state = app.state::<InstallLinkState>();
    if state.pending.lock().unwrap().is_none() || app.state::<BackendState>().is_quitting() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        // bridge_state performs synchronous DNS and TCP probes.
        let backend = app.state::<BackendState>().bridge_state(&app);
        if let Err(error) = crate::ui_dispatch::run_on_main_thread_dispatch(
            &app,
            "resume plugin installation link",
            move |app| {
                let state = app.state::<InstallLinkState>();
                let current_backend = app.state::<BackendState>();
                if current_backend.is_quitting() || state.pending.lock().unwrap().is_none() {
                    return;
                }
                let page = app.state::<Mutex<crate::startup_task::StartupPage>>();
                let startup_failed = matches!(
                    *page.lock().unwrap(),
                    crate::startup_task::StartupPage::NativeError
                );
                let busy = backend.spawning
                    || backend.restarting
                    || crate::restart_backend_flow::is_backend_action_in_progress(&current_backend);
                match pending_action(
                    state.ready.load(Ordering::SeqCst),
                    startup_failed,
                    backend.running,
                    busy,
                ) {
                    PendingAction::Wait => {}
                    PendingAction::Open => open_pending(app),
                    PendingAction::StartBackend => {
                        state.ready.store(false, Ordering::SeqCst);
                        if startup_failed {
                            *page.lock().unwrap() = crate::startup_task::StartupPage::Waiting;
                        }
                        crate::startup_task::spawn_startup_task(
                            app.clone(),
                            crate::append_startup_log,
                        );
                    }
                }
            },
        ) {
            append_desktop_log(&error);
        }
    });
}

fn open_pending(app: &AppHandle) {
    let state = app.state::<InstallLinkState>();
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let Ok(current_url) = window.url() else {
        return;
    };
    let backend = app.state::<BackendState>();
    if !crate::bridge::desktop::should_inject_desktop_bridge(&backend.backend_url, &current_url) {
        return;
    }
    let Some(fragment) = state.pending.lock().unwrap().take() else {
        return;
    };
    match serde_json::to_string(&fragment)
        .map_err(|e| e.to_string())
        .and_then(|fragment| {
            window
                .eval(format!("window.location.hash = {fragment};"))
                .map_err(|e| e.to_string())
        }) {
        Ok(()) => {
            crate::window::actions::show_main_window(app, DEFAULT_SHELL_LOCALE, append_desktop_log)
        }
        Err(error) => {
            *state.pending.lock().unwrap() = Some(fragment);
            append_desktop_log(&format!("failed to open plugin installation link: {error}"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{parse_target, pending_action, PendingAction};

    #[test]
    fn links_wait_during_restart_and_resume_without_a_document_reload() {
        assert_eq!(
            pending_action(true, false, false, true),
            PendingAction::Wait
        );
        assert_eq!(
            pending_action(true, false, true, false),
            PendingAction::Open
        );
        assert_eq!(
            pending_action(false, false, true, false),
            PendingAction::Wait
        );
    }

    #[test]
    fn a_failed_startup_can_be_retried_even_before_the_dashboard_has_loaded() {
        assert_eq!(
            pending_action(true, false, false, false),
            PendingAction::StartBackend
        );
        assert_eq!(
            pending_action(false, true, false, false),
            PendingAction::StartBackend
        );
        // A recovered backend still needs to load the dashboard from the error page.
        assert_eq!(
            pending_action(false, true, true, false),
            PendingAction::StartBackend
        );
        assert_eq!(
            pending_action(false, true, false, true),
            PendingAction::Wait
        );
    }

    #[test]
    fn forwards_metadata_identity_and_custom_source() {
        let target = parse_target("astrbot://extension/plugins?market_plugin_id=%E9%A5%B0%E4%B9%90%2Fdemo&registry_url=https%3A%2F%2Fcloud-test.astrbot.dev%2Fapi%2Fv1%2Fmarket%2Fplugins.json").unwrap();
        assert_eq!(target.plugin_id, "饰乐/demo");
        assert!(target
            .fragment()
            .contains("registry_url=https%3A%2F%2Fcloud-test.astrbot.dev"));
        assert!(
            parse_target("astrbot://extension/plugins?market_plugin_id=author%2Fname")
                .unwrap()
                .registry_url
                .is_none()
        );
    }

    #[test]
    fn rejects_other_actions_credentials_and_ambiguous_parameters() {
        for value in [
            "https://extension/plugins?market_plugin_id=a%2Fb",
            "astrbot://extension/other?market_plugin_id=a%2Fb",
            "astrbot://user@extension/plugins?market_plugin_id=a%2Fb",
            "astrbot://extension/plugins?market_plugin_id=a%2Fb&market_plugin_id=c%2Fd",
            "astrbot://extension/plugins?market_plugin_id=a%2Fb&install_url=https://github.com/a/b",
            "astrbot://extension/plugins?market_plugin_id=invalid",
            "astrbot://extension/plugins?market_plugin_id=a%2Fb&registry_url=http://example.com/plugins.json",
            "astrbot://extension/plugins?market_plugin_id=a%2Fb&registry_url=https://user:pass@example.com/plugins.json",
        ] { assert!(parse_target(value).is_none(), "{value}"); }
    }
}

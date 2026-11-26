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

pub(crate) fn setup(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "linux")]
    app.deep_link().register_all()?;
    let handle = app.handle().clone();
    app.deep_link().on_open_url(move |event| {
        for url in event.urls() {
            receive(&handle, url.as_str());
        }
    });
    if let Some(urls) = app.deep_link().get_current()? {
        for url in urls {
            receive(app.handle(), url.as_str());
        }
    }
    Ok(())
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
            if state.ready.load(Ordering::SeqCst) {
                let backend = app.state::<BackendState>().bridge_state(app);
                if backend.spawning || backend.restarting {
                    state.ready.store(false, Ordering::SeqCst);
                    return;
                }
                if !backend.running && !backend.spawning && !backend.restarting {
                    state.ready.store(false, Ordering::SeqCst);
                    crate::startup_task::spawn_startup_task(app.clone(), crate::append_startup_log);
                } else {
                    open_pending(app);
                }
            }
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
    open_pending(app);
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
    use super::parse_target;

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

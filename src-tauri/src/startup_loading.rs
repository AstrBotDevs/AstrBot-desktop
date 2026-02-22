use std::env;

use tauri::{AppHandle, Manager};
use url::Url;

use crate::{startup_mode, BackendState};

pub fn should_apply_startup_loading_mode(webview_label: &str, page_url: &Url) -> bool {
    if webview_label != "main" {
        return false;
    }

    if matches!(page_url.scheme(), "http" | "https") {
        return false;
    }

    let path = page_url.path();
    path == "/" || path == "/index.html"
}

pub fn apply_startup_loading_mode<F>(
    app_handle: &AppHandle,
    webview: &tauri::Webview<tauri::Wry>,
    startup_mode_env: &str,
    log: F,
) where
    F: Fn(&str) + Copy,
{
    let mode = resolve_startup_loading_mode(app_handle, startup_mode_env, log);
    let mode_js = serde_json::to_string(mode).expect("serializing startup mode");
    let script = format!(
        "if (typeof window !== 'undefined' && typeof window.__astrbotSetStartupMode === 'function') {{ window.__astrbotSetStartupMode({mode_js}); }}"
    );
    if let Err(error) = webview.eval(&script) {
        log(&format!("failed to apply startup loading mode: {error}"));
    }
}

fn resolve_startup_loading_mode<F>(
    app_handle: &AppHandle,
    startup_mode_env: &str,
    log: F,
) -> &'static str
where
    F: Fn(&str) + Copy,
{
    let state = app_handle.state::<BackendState>();
    match state.startup_loading_mode.lock() {
        Ok(guard) => {
            if let Some(mode) = *guard {
                return mode;
            }
        }
        Err(error) => {
            log(&format!(
                "startup loading mode cache lock poisoned (read), recomputing mode: {error}"
            ));
        }
    }

    let mode = resolve_startup_loading_mode_uncached(&state, app_handle, startup_mode_env, log);
    match state.startup_loading_mode.lock() {
        Ok(mut guard) => {
            *guard = Some(mode);
        }
        Err(error) => {
            log(&format!(
                "startup loading mode cache lock poisoned (write), skip cache update: {error}"
            ));
        }
    }
    mode
}

fn resolve_startup_loading_mode_uncached<F>(
    state: &BackendState,
    app_handle: &AppHandle,
    startup_mode_env: &str,
    log: F,
) -> &'static str
where
    F: Fn(&str) + Copy,
{
    if let Ok(raw_mode) = env::var(startup_mode_env) {
        let (mode, message) = startup_mode::resolve_mode_from_env(&raw_mode, startup_mode_env);
        if let Some(message) = message {
            log(&message);
        }
        return mode.as_str();
    }

    match state.resolve_launch_plan(app_handle) {
        Ok(plan) => {
            let (mode, message) =
                startup_mode::resolve_mode_from_webui_dir(plan.webui_dir.as_deref());
            if let Some(message) = message {
                log(&message);
            }
            mode.as_str()
        }
        Err(error) => {
            log(&format!(
                "failed to resolve startup mode from launch plan, fallback to loading: {error}"
            ));
            startup_mode::STARTUP_MODE_LOADING
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_apply_startup_loading_mode_requires_main_window_and_local_index() {
        let file_index = Url::parse("file:///index.html").expect("parse file url");
        assert!(should_apply_startup_loading_mode("main", &file_index));

        let http_index = Url::parse("http://127.0.0.1:6185/").expect("parse http url");
        assert!(!should_apply_startup_loading_mode("main", &http_index));
        assert!(!should_apply_startup_loading_mode("other", &file_index));
    }
}

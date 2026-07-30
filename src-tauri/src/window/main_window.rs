use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Manager};
use url::Url;

pub fn show_main_window<F>(app_handle: &AppHandle, log: F)
where
    F: Fn(&str),
{
    let Some(window) = app_handle.get_webview_window("main") else {
        log("show_main_window skipped: main window not found");
        return;
    };

    if let Err(error) = window.unminimize() {
        log(&format!("failed to unminimize main window: {error}"));
    }
    if let Err(error) = window.show() {
        log(&format!("failed to show main window: {error}"));
    }
    if let Err(error) = window.set_focus() {
        log(&format!("failed to focus main window: {error}"));
    }
}

pub fn hide_main_window<F>(app_handle: &AppHandle, log: F)
where
    F: Fn(&str),
{
    let Some(window) = app_handle.get_webview_window("main") else {
        log("hide_main_window skipped: main window not found");
        return;
    };
    if let Err(error) = window.hide() {
        log(&format!("failed to hide main window: {error}"));
    }
}

pub fn reload_main_window<F>(app_handle: &AppHandle, log: F)
where
    F: Fn(&str),
{
    let Some(window) = app_handle.get_webview_window("main") else {
        log("reload_main_window skipped: main window not found");
        return;
    };
    if let Err(error) = window.reload() {
        log(&format!("failed to reload main window: {error}"));
    }
}

pub fn navigate_main_window_to_backend(
    app_handle: &AppHandle,
    backend_url: &str,
) -> Result<(), String> {
    let cache_buster = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let navigation_url = backend_navigation_url(backend_url, cache_buster);
    let backend_url_json =
        serde_json::to_string(&navigation_url).unwrap_or_else(|_| "\"/\"".to_string());
    let Some(window) = app_handle.get_webview_window("main") else {
        return Err("Main window is unavailable after backend startup.".to_string());
    };

    let js = format!("window.location.replace({backend_url_json});");
    window
        .eval(&js)
        .map_err(|error| format!("Failed to navigate to backend dashboard: {error}"))
}

fn backend_navigation_url(backend_url: &str, cache_buster: u128) -> String {
    let Ok(mut url) = Url::parse(backend_url) else {
        return backend_url.to_string();
    };
    url.query_pairs_mut()
        .append_pair("_desktop_boot", &cache_buster.to_string());
    url.into()
}

#[cfg(test)]
mod tests {
    use super::backend_navigation_url;

    #[test]
    fn backend_navigation_adds_a_document_cache_buster() {
        assert_eq!(
            backend_navigation_url("http://127.0.0.1:6185", 1234),
            "http://127.0.0.1:6185/?_desktop_boot=1234"
        );
    }

    #[test]
    fn backend_navigation_preserves_existing_query_parameters() {
        assert_eq!(
            backend_navigation_url("http://127.0.0.1:6185/?channel=stable", 1234),
            "http://127.0.0.1:6185/?channel=stable&_desktop_boot=1234"
        );
    }
}

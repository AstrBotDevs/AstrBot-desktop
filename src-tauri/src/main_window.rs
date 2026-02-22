use tauri::{AppHandle, Manager};

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
    let backend_url_json =
        serde_json::to_string(backend_url).unwrap_or_else(|_| "\"/\"".to_string());
    let Some(window) = app_handle.get_webview_window("main") else {
        return Err("Main window is unavailable after backend startup.".to_string());
    };

    let js = format!("window.location.replace({backend_url_json});");
    window
        .eval(&js)
        .map_err(|error| format!("Failed to navigate to backend dashboard: {error}"))
}

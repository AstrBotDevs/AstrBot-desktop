use tauri::{AppHandle, Manager};

use crate::{main_window, tray_labels};

pub fn show_main_window<F>(app_handle: &AppHandle, default_shell_locale: &'static str, log: F)
where
    F: Fn(&str),
{
    main_window::show_main_window(app_handle, &log);
    tray_labels::update_tray_menu_labels_with_visibility(
        app_handle,
        default_shell_locale,
        Some(true),
        log,
    );
}

pub fn hide_main_window<F>(app_handle: &AppHandle, default_shell_locale: &'static str, log: F)
where
    F: Fn(&str),
{
    main_window::hide_main_window(app_handle, &log);
    tray_labels::update_tray_menu_labels_with_visibility(
        app_handle,
        default_shell_locale,
        Some(false),
        log,
    );
}

pub fn toggle_main_window<F>(app_handle: &AppHandle, default_shell_locale: &'static str, log: F)
where
    F: Fn(&str) + Copy,
{
    let Some(window) = app_handle.get_webview_window("main") else {
        log("toggle_main_window skipped: main window not found");
        return;
    };

    match window.is_visible() {
        Ok(true) => hide_main_window(app_handle, default_shell_locale, log),
        Ok(false) => show_main_window(app_handle, default_shell_locale, log),
        Err(error) => log(&format!(
            "failed to read main window visibility in toggle_main_window: {error}"
        )),
    }
}

pub fn reload_main_window<F>(app_handle: &AppHandle, log: F)
where
    F: Fn(&str),
{
    main_window::reload_main_window(app_handle, log);
}

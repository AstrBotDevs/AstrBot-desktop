use tauri::{menu::MenuItem, AppHandle, Manager};

use crate::{runtime_paths, shell_locale, tray_actions, TrayMenuState};

fn set_menu_text_safe<F>(item: &MenuItem<tauri::Wry>, text: &str, item_name: &str, log: F)
where
    F: Fn(&str),
{
    if let Err(error) = item.set_text(text) {
        log(&format!(
            "failed to update tray menu text for {}: {}",
            item_name, error
        ));
    }
}

pub fn update_tray_menu_labels<F>(
    app_handle: &AppHandle,
    default_shell_locale: &'static str,
    log: F,
) where
    F: Fn(&str),
{
    let Some(tray_state) = app_handle.try_state::<TrayMenuState>() else {
        return;
    };

    let locale = shell_locale::resolve_shell_locale(
        default_shell_locale,
        runtime_paths::default_packaged_root_dir(),
    );
    let shell_texts = shell_locale::shell_texts_for_locale(locale);
    let is_visible = app_handle
        .get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(true);

    let toggle_label = if is_visible {
        shell_texts.tray_hide
    } else {
        shell_texts.tray_show
    };

    set_menu_text_safe(
        &tray_state.toggle_item,
        toggle_label,
        tray_actions::TRAY_MENU_TOGGLE_WINDOW,
        &log,
    );
    set_menu_text_safe(
        &tray_state.reload_item,
        shell_texts.tray_reload,
        tray_actions::TRAY_MENU_RELOAD_WINDOW,
        &log,
    );
    set_menu_text_safe(
        &tray_state.restart_backend_item,
        shell_texts.tray_restart_backend,
        tray_actions::TRAY_MENU_RESTART_BACKEND,
        &log,
    );
    set_menu_text_safe(
        &tray_state.quit_item,
        shell_texts.tray_quit,
        tray_actions::TRAY_MENU_QUIT,
        &log,
    );
}

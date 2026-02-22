use tauri::{AppHandle, Manager};

use crate::{
    append_desktop_log, append_restart_log, append_shutdown_log, restart_backend_flow,
    tray_actions, tray_bridge_event, ui_dispatch, window_actions, BackendState,
    DEFAULT_SHELL_LOCALE, TRAY_RESTART_BACKEND_EVENT,
};

pub fn handle_tray_menu_event(app_handle: &AppHandle, menu_id: &str) {
    match tray_actions::action_from_menu_id(menu_id) {
        Some(tray_actions::TrayMenuAction::ToggleWindow) => {
            window_actions::toggle_main_window(app_handle, DEFAULT_SHELL_LOCALE, append_desktop_log)
        }
        Some(tray_actions::TrayMenuAction::ReloadWindow) => {
            window_actions::reload_main_window(app_handle, append_desktop_log)
        }
        Some(tray_actions::TrayMenuAction::RestartBackend) => {
            let state = app_handle.state::<BackendState>();
            if restart_backend_flow::is_backend_action_in_progress(&state) {
                append_restart_log("tray restart ignored: backend action already in progress");
                return;
            }
            append_restart_log("tray requested backend restart");
            window_actions::show_main_window(app_handle, DEFAULT_SHELL_LOCALE, append_desktop_log);
            tray_bridge_event::emit_tray_restart_backend_event(
                app_handle,
                TRAY_RESTART_BACKEND_EVENT,
                append_restart_log,
            );

            let app_handle_cloned = app_handle.clone();
            tauri::async_runtime::spawn(async move {
                let result =
                    restart_backend_flow::run_restart_backend_task(app_handle_cloned.clone(), None)
                        .await;
                if result.ok {
                    append_restart_log("backend restarted from tray menu");
                    if let Err(error) = ui_dispatch::run_on_main_thread_dispatch(
                        &app_handle_cloned,
                        "reload main window after tray restart",
                        move |main_app| {
                            window_actions::reload_main_window(main_app, append_desktop_log);
                        },
                    ) {
                        append_restart_log(&format!(
                            "failed to schedule main window reload after tray restart: {error}"
                        ));
                    }
                } else {
                    let reason = result.reason.unwrap_or_else(|| "unknown error".to_string());
                    append_restart_log(&format!("backend restart from tray menu failed: {reason}"));
                }
            });
        }
        Some(tray_actions::TrayMenuAction::Quit) => {
            let state = app_handle.state::<BackendState>();
            state.mark_quitting();
            append_shutdown_log("tray quit requested, exiting desktop process");
            app_handle.exit(0);
        }
        None => {}
    }
}

use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter, Manager};

static TRAY_RESTART_SIGNAL_TOKEN: AtomicU64 = AtomicU64::new(0);

pub fn emit_tray_restart_backend_event<F>(app_handle: &AppHandle, event_name: &str, log: F)
where
    F: Fn(&str),
{
    let Some(window) = app_handle.get_webview_window("main") else {
        log("tray restart event skipped: main window not found");
        return;
    };
    let token = TRAY_RESTART_SIGNAL_TOKEN.fetch_add(1, Ordering::Relaxed) + 1;

    if let Err(error) = window.emit(event_name, token) {
        log(&format!(
            "failed to emit tray restart backend event: {error}"
        ));
    }
}

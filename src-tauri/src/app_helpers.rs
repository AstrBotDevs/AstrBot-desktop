use std::{
    ffi::OsString,
    sync::{Mutex, OnceLock},
};

use tauri::{AppHandle, Manager};

use crate::{
    backend_path, desktop_bridge, logging, main_window, runtime_paths, BackendState, LaunchPlan,
    DESKTOP_LOG_FILE, DESKTOP_LOG_MAX_BYTES, LOG_BACKUP_COUNT, TRAY_RESTART_BACKEND_EVENT,
};

static DESKTOP_LOG_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static BACKEND_PATH_OVERRIDE: OnceLock<Option<OsString>> = OnceLock::new();

pub(crate) fn navigate_main_window_to_backend(app_handle: &AppHandle) -> Result<(), String> {
    let state = app_handle.state::<BackendState>();
    main_window::navigate_main_window_to_backend(app_handle, &state.backend_url)
}

pub(crate) fn inject_desktop_bridge(webview: &tauri::Webview<tauri::Wry>) {
    desktop_bridge::inject_desktop_bridge(webview, TRAY_RESTART_BACKEND_EVENT, append_desktop_log);
}

pub(crate) fn backend_path_override() -> Option<OsString> {
    BACKEND_PATH_OVERRIDE
        .get_or_init(|| {
            backend_path::build_backend_path_override(|message| append_desktop_log(&message))
        })
        .clone()
}

pub(crate) fn build_debug_command(plan: &LaunchPlan) -> Vec<String> {
    let mut parts = vec![plan.cmd.clone()];
    parts.extend(plan.args.clone());
    parts
}

pub(crate) fn append_desktop_log(message: &str) {
    append_desktop_log_with_category(logging::DesktopLogCategory::Runtime, message);
}

pub(crate) fn append_startup_log(message: &str) {
    append_desktop_log_with_category(logging::DesktopLogCategory::Startup, message);
}

pub(crate) fn append_restart_log(message: &str) {
    append_desktop_log_with_category(logging::DesktopLogCategory::Restart, message);
}

pub(crate) fn append_shutdown_log(message: &str) {
    append_desktop_log_with_category(logging::DesktopLogCategory::Shutdown, message);
}

fn append_desktop_log_with_category(category: logging::DesktopLogCategory, message: &str) {
    logging::append_desktop_log(
        category,
        message,
        runtime_paths::default_packaged_root_dir(),
        DESKTOP_LOG_FILE,
        DESKTOP_LOG_MAX_BYTES,
        LOG_BACKUP_COUNT,
        &DESKTOP_LOG_WRITE_LOCK,
    )
}

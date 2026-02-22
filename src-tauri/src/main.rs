#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod backend_config;
mod backend_http;
mod backend_path;
mod backend_process_lifecycle;
mod backend_restart;
mod backend_runtime;
mod backend_startup;
mod desktop_bridge;
mod exit_cleanup;
mod exit_events;
mod exit_state;
mod http_response;
mod launch_plan;
mod logging;
mod main_window;
mod origin_policy;
mod packaged_webui;
mod process_control;
mod restart_backend_flow;
mod runtime_paths;
mod shell_locale;
mod startup_loading;
mod startup_mode;
mod startup_task;
mod tray_actions;
mod tray_bridge_event;
mod tray_labels;
mod tray_menu_handler;
mod tray_setup;
mod ui_dispatch;
mod webui_paths;
mod window_actions;

use serde::Deserialize;
use std::{
    env,
    ffi::OsString,
    path::PathBuf,
    process::Child,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};
use tauri::{menu::MenuItem, webview::PageLoadEvent, AppHandle, Manager, RunEvent, WindowEvent};

const DEFAULT_BACKEND_URL: &str = "http://127.0.0.1:6185/";
const BACKEND_TIMEOUT_ENV: &str = "ASTRBOT_BACKEND_TIMEOUT_MS";
const PACKAGED_BACKEND_TIMEOUT_FALLBACK_MS: u64 = 5 * 60 * 1000;
const GRACEFUL_RESTART_REQUEST_TIMEOUT_MS: u64 = 2_500;
const GRACEFUL_RESTART_START_TIME_TIMEOUT_MS: u64 = 1_800;
const GRACEFUL_RESTART_POLL_INTERVAL_MS: u64 = 350;
const GRACEFUL_STOP_TIMEOUT_MS: u64 = 10_000;
const DEFAULT_BACKEND_READY_POLL_INTERVAL_MS: u64 = 300;
const BACKEND_READY_POLL_INTERVAL_MIN_MS: u64 = 50;
const BACKEND_READY_POLL_INTERVAL_MAX_MS: u64 = 10_000;
const BACKEND_READY_POLL_INTERVAL_ENV: &str = "ASTRBOT_BACKEND_READY_POLL_INTERVAL_MS";
const DEFAULT_BACKEND_READY_HTTP_PATH: &str = "/api/stat/start-time";
const BACKEND_READY_HTTP_PATH_ENV: &str = "ASTRBOT_BACKEND_READY_HTTP_PATH";
const BACKEND_READY_PROBE_TIMEOUT_ENV: &str = "ASTRBOT_BACKEND_READY_PROBE_TIMEOUT_MS";
const BACKEND_READY_PROBE_TIMEOUT_MIN_MS: u64 = 100;
const BACKEND_READY_PROBE_TIMEOUT_MAX_MS: u64 = 30_000;
const BACKEND_READY_TCP_PROBE_TIMEOUT_MAX_MS: u64 = 1_000;
const DEFAULT_BACKEND_PING_TIMEOUT_MS: u64 = 800;
const BACKEND_PING_TIMEOUT_MIN_MS: u64 = 50;
const BACKEND_PING_TIMEOUT_MAX_MS: u64 = 30_000;
const BACKEND_PING_TIMEOUT_ENV: &str = "ASTRBOT_BACKEND_PING_TIMEOUT_MS";
const BRIDGE_BACKEND_PING_TIMEOUT_ENV: &str = "ASTRBOT_BRIDGE_BACKEND_PING_TIMEOUT_MS";
const DESKTOP_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;
const BACKEND_LOG_MAX_BYTES: u64 = 20 * 1024 * 1024;
const LOG_BACKUP_COUNT: usize = 5;
const BACKEND_LOG_ROTATION_CHECK_INTERVAL: Duration = Duration::from_secs(20);
const DESKTOP_LOG_FILE: &str = "desktop.log";
const TRAY_ID: &str = "astrbot-tray";
const TRAY_RESTART_BACKEND_EVENT: &str = "astrbot://tray-restart-backend";
const DEFAULT_SHELL_LOCALE: &str = "zh-CN";
const STARTUP_MODE_ENV: &str = "ASTRBOT_DESKTOP_STARTUP_MODE";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
static DESKTOP_LOG_WRITE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static BACKEND_PATH_OVERRIDE: OnceLock<Option<OsString>> = OnceLock::new();

#[derive(Clone)]
struct TrayMenuState {
    toggle_item: MenuItem<tauri::Wry>,
    reload_item: MenuItem<tauri::Wry>,
    restart_backend_item: MenuItem<tauri::Wry>,
    quit_item: MenuItem<tauri::Wry>,
}

#[derive(Debug, Deserialize)]
struct RuntimeManifest {
    python: Option<String>,
    entrypoint: Option<String>,
}

#[derive(Debug)]
struct LaunchPlan {
    cmd: String,
    args: Vec<String>,
    cwd: PathBuf,
    root_dir: Option<PathBuf>,
    webui_dir: Option<PathBuf>,
    packaged_mode: bool,
}

#[derive(Debug)]
struct BackendState {
    child: Mutex<Option<Child>>,
    backend_url: String,
    restart_auth_token: Mutex<Option<String>>,
    startup_loading_mode: Mutex<Option<&'static str>>,
    log_rotator_stop: Mutex<Option<Arc<AtomicBool>>>,
    exit_state: Mutex<exit_state::ExitStateMachine>,
    is_spawning: AtomicBool,
    is_restarting: AtomicBool,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendBridgeState {
    running: bool,
    spawning: bool,
    restarting: bool,
    can_manage: bool,
}

#[derive(Debug, serde::Serialize)]
struct BackendBridgeResult {
    ok: bool,
    reason: Option<String>,
}

struct AtomicFlagGuard<'a> {
    flag: &'a AtomicBool,
}

impl<'a> AtomicFlagGuard<'a> {
    fn set(flag: &'a AtomicBool) -> Self {
        flag.store(true, Ordering::Relaxed);
        Self { flag }
    }

    fn try_set(flag: &'a AtomicBool) -> Option<Self> {
        flag.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()?;
        Some(Self { flag })
    }
}

impl Drop for AtomicFlagGuard<'_> {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Relaxed);
    }
}

impl Default for BackendState {
    fn default() -> Self {
        Self {
            child: Mutex::new(None),
            backend_url: backend_config::normalize_backend_url(
                &env::var("ASTRBOT_BACKEND_URL")
                    .unwrap_or_else(|_| DEFAULT_BACKEND_URL.to_string()),
                DEFAULT_BACKEND_URL,
            ),
            restart_auth_token: Mutex::new(None),
            startup_loading_mode: Mutex::new(None),
            log_rotator_stop: Mutex::new(None),
            exit_state: Mutex::new(exit_state::ExitStateMachine::default()),
            is_spawning: AtomicBool::new(false),
            is_restarting: AtomicBool::new(false),
        }
    }
}

impl BackendState {
    fn mark_quitting(&self) {
        match self.exit_state.lock() {
            Ok(mut guard) => guard.mark_quitting(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when marking quitting: {error}"
                ));
                error.into_inner().mark_quitting();
            }
        }
    }

    fn is_quitting(&self) -> bool {
        match self.exit_state.lock() {
            Ok(guard) => guard.is_quitting(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when reading quitting state: {error}"
                ));
                error.into_inner().is_quitting()
            }
        }
    }

    fn try_begin_exit_cleanup(&self) -> bool {
        match self.exit_state.lock() {
            Ok(mut guard) => guard.try_begin_cleanup(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when beginning cleanup: {error}"
                ));
                error.into_inner().try_begin_cleanup()
            }
        }
    }

    fn allow_next_exit_request(&self) {
        match self.exit_state.lock() {
            Ok(mut guard) => guard.allow_next_exit_request(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when allowing next exit request: {error}"
                ));
                error.into_inner().allow_next_exit_request();
            }
        }
    }

    fn take_exit_request_allowance(&self) -> bool {
        match self.exit_state.lock() {
            Ok(mut guard) => guard.take_exit_request_allowance(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when taking exit request allowance: {error}"
                ));
                error.into_inner().take_exit_request_allowance()
            }
        }
    }
}

#[tauri::command]
fn desktop_bridge_is_desktop_runtime() -> bool {
    true
}

#[tauri::command]
fn desktop_bridge_get_backend_state(app_handle: AppHandle) -> BackendBridgeState {
    let state = app_handle.state::<BackendState>();
    state.bridge_state(&app_handle)
}

#[tauri::command]
fn desktop_bridge_set_auth_token(
    app_handle: AppHandle,
    auth_token: Option<String>,
) -> BackendBridgeResult {
    let state = app_handle.state::<BackendState>();
    state.set_restart_auth_token(auth_token.as_deref());
    BackendBridgeResult {
        ok: true,
        reason: None,
    }
}

#[tauri::command]
async fn desktop_bridge_restart_backend(
    app_handle: AppHandle,
    auth_token: Option<String>,
) -> BackendBridgeResult {
    let state = app_handle.state::<BackendState>();
    if restart_backend_flow::is_backend_action_in_progress(&state) {
        return BackendBridgeResult {
            ok: false,
            reason: Some("Backend action already in progress.".to_string()),
        };
    }

    restart_backend_flow::run_restart_backend_task(app_handle, auth_token).await
}

#[tauri::command]
fn desktop_bridge_stop_backend(app_handle: AppHandle) -> BackendBridgeResult {
    let state = app_handle.state::<BackendState>();
    if restart_backend_flow::is_backend_action_in_progress(&state) {
        return BackendBridgeResult {
            ok: false,
            reason: Some("Backend action already in progress.".to_string()),
        };
    }

    match state.stop_backend_for_bridge() {
        Ok(()) => BackendBridgeResult {
            ok: true,
            reason: None,
        },
        Err(error) => BackendBridgeResult {
            ok: false,
            reason: Some(error),
        },
    }
}

fn main() {
    append_startup_log("desktop process starting");
    append_startup_log(&format!(
        "desktop log path: {}",
        logging::resolve_desktop_log_path(
            runtime_paths::default_packaged_root_dir(),
            DESKTOP_LOG_FILE,
        )
        .display()
    ));
    tauri::Builder::default()
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_bridge_is_desktop_runtime,
            desktop_bridge_get_backend_state,
            desktop_bridge_set_auth_token,
            desktop_bridge_restart_backend,
            desktop_bridge_stop_backend
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }

            match event {
                WindowEvent::CloseRequested { api, .. } => {
                    let app_handle = window.app_handle();
                    let state = app_handle.state::<BackendState>();
                    if state.is_quitting() {
                        return;
                    }

                    api.prevent_close();
                    window_actions::hide_main_window(
                        app_handle,
                        DEFAULT_SHELL_LOCALE,
                        append_desktop_log,
                    );
                }
                WindowEvent::Focused(false) => {
                    if let Ok(true) = window.is_minimized() {
                        let app_handle = window.app_handle();
                        let state = app_handle.state::<BackendState>();
                        if !state.is_quitting() {
                            window_actions::hide_main_window(
                                app_handle,
                                DEFAULT_SHELL_LOCALE,
                                append_desktop_log,
                            );
                        }
                    }
                }
                _ => {}
            }
        })
        .on_page_load(|webview, payload| match payload.event() {
            PageLoadEvent::Started => {
                append_desktop_log(&format!("page-load started: {}", payload.url()));
                let state = webview.app_handle().state::<BackendState>();
                if desktop_bridge::should_inject_desktop_bridge(&state.backend_url, payload.url()) {
                    inject_desktop_bridge(webview);
                }
            }
            PageLoadEvent::Finished => {
                append_desktop_log(&format!("page-load finished: {}", payload.url()));
                let state = webview.app_handle().state::<BackendState>();
                if desktop_bridge::should_inject_desktop_bridge(&state.backend_url, payload.url()) {
                    inject_desktop_bridge(webview);
                } else if startup_loading::should_apply_startup_loading_mode(
                    webview.window().label(),
                    payload.url(),
                ) {
                    startup_loading::apply_startup_loading_mode(
                        webview.app_handle(),
                        webview,
                        STARTUP_MODE_ENV,
                        append_startup_log,
                    );
                }
            }
        })
        .setup(|app| {
            let app_handle = app.handle().clone();
            if let Err(error) = tray_setup::setup_tray(&app_handle) {
                append_startup_log(&format!("failed to initialize tray: {error}"));
            }

            startup_task::spawn_startup_task(app_handle.clone(), append_startup_log);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| match event {
            RunEvent::ExitRequested { api, .. } => {
                exit_events::handle_exit_requested(app_handle, &api);
            }
            RunEvent::Exit => {
                exit_events::handle_exit_event(app_handle);
            }
            _ => {}
        });
}

fn navigate_main_window_to_backend(app_handle: &AppHandle) -> Result<(), String> {
    let state = app_handle.state::<BackendState>();
    main_window::navigate_main_window_to_backend(app_handle, &state.backend_url)
}

fn inject_desktop_bridge(webview: &tauri::Webview<tauri::Wry>) {
    desktop_bridge::inject_desktop_bridge(webview, TRAY_RESTART_BACKEND_EVENT, append_desktop_log);
}

fn backend_path_override() -> Option<OsString> {
    BACKEND_PATH_OVERRIDE
        .get_or_init(|| {
            backend_path::build_backend_path_override(|message| append_desktop_log(&message))
        })
        .clone()
}

fn build_debug_command(plan: &LaunchPlan) -> Vec<String> {
    let mut parts = vec![plan.cmd.clone()];
    parts.extend(plan.args.clone());
    parts
}

fn append_desktop_log(message: &str) {
    append_desktop_log_with_category(logging::DesktopLogCategory::Runtime, message);
}

fn append_startup_log(message: &str) {
    append_desktop_log_with_category(logging::DesktopLogCategory::Startup, message);
}

fn append_restart_log(message: &str) {
    append_desktop_log_with_category(logging::DesktopLogCategory::Restart, message);
}

fn append_shutdown_log(message: &str) {
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

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_constants;
mod app_helpers;
mod app_runtime;
mod app_types;
mod backend_config;
mod backend_exit_state;
mod backend_http;
mod backend_launch;
mod backend_path;
mod backend_process_lifecycle;
mod backend_readiness;
mod backend_restart;
mod backend_runtime;
mod desktop_bridge;
mod desktop_bridge_commands;
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

pub(crate) use app_constants::*;
pub(crate) use app_helpers::{
    append_desktop_log, append_restart_log, append_shutdown_log, append_startup_log,
    backend_path_override, build_debug_command, inject_desktop_bridge,
    navigate_main_window_to_backend,
};
pub(crate) use app_types::{
    AtomicFlagGuard, BackendBridgeResult, BackendBridgeState, BackendState, LaunchPlan,
    RuntimeManifest, TrayMenuState,
};

fn main() {
    app_runtime::run();
}

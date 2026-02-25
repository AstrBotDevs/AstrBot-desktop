use std::{fs, path::Path, process::Command};

use tauri::{webview::PageLoadEvent, Manager, RunEvent, WindowEvent};

use crate::{
    append_desktop_log, append_startup_log, desktop_bridge, exit_events, startup_loading,
    startup_task, tray_setup, window_actions, BackendState, RuntimeManifest, DEFAULT_SHELL_LOCALE,
    DESKTOP_LOG_FILE, STARTUP_MODE_ENV,
};

fn desktop_git_commit() -> &'static str {
    option_env!("ASTRBOT_DESKTOP_GIT_COMMIT").unwrap_or("unknown")
}

fn resolve_git_head(repo_dir: &Path) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_dir)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let commit = String::from_utf8(output.stdout).ok()?;
    let trimmed = commit.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn resolve_astrbot_source_commit_from_manifest(app_handle: &tauri::AppHandle) -> Option<String> {
    let manifest_path = crate::runtime_paths::resolve_resource_path(
        app_handle,
        "backend/runtime-manifest.json",
        |_| {},
    )?;
    let manifest_raw = fs::read_to_string(manifest_path).ok()?;
    let manifest: RuntimeManifest = serde_json::from_str(&manifest_raw).ok()?;
    let commit = manifest.source_commit?;
    if commit.trim().is_empty() {
        None
    } else {
        Some(commit)
    }
}

fn resolve_astrbot_source_commit() -> Option<String> {
    crate::runtime_paths::detect_astrbot_source_root()
        .and_then(|source_root| resolve_git_head(&source_root))
}

pub(crate) fn run() {
    append_startup_log("desktop process starting");
    append_startup_log(&format!(
        "desktop log path: {}",
        crate::logging::resolve_desktop_log_path(
            crate::runtime_paths::default_packaged_root_dir(),
            DESKTOP_LOG_FILE,
        )
        .display()
    ));
    append_startup_log(&format!("desktop version: {}", env!("CARGO_PKG_VERSION")));
    append_startup_log(&format!("desktop commit: {}", desktop_git_commit()));
    tauri::Builder::default()
        .manage(BackendState::default())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            crate::desktop_bridge_commands::desktop_bridge_is_desktop_runtime,
            crate::desktop_bridge_commands::desktop_bridge_get_backend_state,
            crate::desktop_bridge_commands::desktop_bridge_set_auth_token,
            crate::desktop_bridge_commands::desktop_bridge_set_shell_locale,
            crate::desktop_bridge_commands::desktop_bridge_restart_backend,
            crate::desktop_bridge_commands::desktop_bridge_stop_backend,
            crate::desktop_bridge_commands::desktop_bridge_open_external_url,
            crate::desktop_bridge_commands::desktop_bridge_check_desktop_app_update,
            crate::desktop_bridge_commands::desktop_bridge_install_desktop_app_update
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
                    crate::inject_desktop_bridge(webview);
                }
            }
            PageLoadEvent::Finished => {
                append_desktop_log(&format!("page-load finished: {}", payload.url()));
                let state = webview.app_handle().state::<BackendState>();
                if desktop_bridge::should_inject_desktop_bridge(&state.backend_url, payload.url()) {
                    crate::inject_desktop_bridge(webview);
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
            let astrbot_source_commit = resolve_astrbot_source_commit_from_manifest(&app_handle)
                .or_else(resolve_astrbot_source_commit)
                .unwrap_or_else(|| "unknown".to_string());
            append_startup_log(&format!("astrbot source commit: {astrbot_source_commit}"));

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

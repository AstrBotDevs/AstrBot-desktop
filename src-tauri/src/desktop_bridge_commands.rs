use tauri::{AppHandle, Manager};

use crate::{restart_backend_flow, BackendBridgeResult, BackendBridgeState, BackendState};

#[tauri::command]
pub(crate) fn desktop_bridge_is_desktop_runtime() -> bool {
    true
}

#[tauri::command]
pub(crate) fn desktop_bridge_get_backend_state(app_handle: AppHandle) -> BackendBridgeState {
    let state = app_handle.state::<BackendState>();
    state.bridge_state(&app_handle)
}

#[tauri::command]
pub(crate) fn desktop_bridge_set_auth_token(
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
pub(crate) async fn desktop_bridge_restart_backend(
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
pub(crate) fn desktop_bridge_stop_backend(app_handle: AppHandle) -> BackendBridgeResult {
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

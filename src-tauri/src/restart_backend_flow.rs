use std::sync::atomic::Ordering;

use tauri::{AppHandle, Manager};

use crate::{BackendBridgeResult, BackendState};

fn do_restart_backend(app_handle: &AppHandle, auth_token: Option<&str>) -> Result<(), String> {
    let state = app_handle.state::<BackendState>();
    state.restart_backend(app_handle, auth_token)
}

pub fn is_backend_action_in_progress(state: &BackendState) -> bool {
    state.is_spawning.load(Ordering::Relaxed) || state.is_restarting.load(Ordering::Relaxed)
}

pub async fn run_restart_backend_task(
    app_handle: AppHandle,
    auth_token: Option<String>,
) -> BackendBridgeResult {
    let app_handle_for_worker = app_handle.clone();
    match tauri::async_runtime::spawn_blocking(move || {
        do_restart_backend(&app_handle_for_worker, auth_token.as_deref())
    })
    .await
    {
        Ok(Ok(())) => BackendBridgeResult {
            ok: true,
            reason: None,
        },
        Ok(Err(error)) => BackendBridgeResult {
            ok: false,
            reason: Some(error),
        },
        Err(error) => BackendBridgeResult {
            ok: false,
            reason: Some(format!("Backend restart task failed: {error}")),
        },
    }
}

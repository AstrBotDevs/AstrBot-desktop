use tauri::{AppHandle, Manager};

use crate::{append_shutdown_log, exit_cleanup, BackendState};

pub fn handle_exit_requested(app_handle: &AppHandle, api: &tauri::ExitRequestApi) {
    let state = app_handle.state::<BackendState>();
    if state.take_exit_request_allowance() {
        append_shutdown_log("exit request allowed to pass through after backend cleanup");
        return;
    }
    // Prevent immediate process exit so backend shutdown can run in the runtime's
    // blocking pool; we exit explicitly after stop_backend() finishes.
    api.prevent_exit();
    if !exit_cleanup::try_begin_exit_cleanup(
        &state,
        exit_cleanup::ExitTrigger::ExitRequested,
        append_shutdown_log,
    ) {
        return;
    }

    append_shutdown_log("exit requested, stopping backend asynchronously");
    let app_handle_cloned = app_handle.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle_cloned.state::<BackendState>();
        exit_cleanup::stop_backend_for_exit(
            &state,
            exit_cleanup::ExitTrigger::ExitRequested,
            append_shutdown_log,
        );
        state.allow_next_exit_request();
        app_handle_cloned.exit(0);
    });
}

pub fn handle_exit_event(app_handle: &AppHandle) {
    let state = app_handle.state::<BackendState>();
    if !exit_cleanup::try_begin_exit_cleanup(
        &state,
        exit_cleanup::ExitTrigger::ExitFallback,
        append_shutdown_log,
    ) {
        return;
    }

    append_shutdown_log("exit event triggered fallback backend cleanup");
    exit_cleanup::stop_backend_for_exit(
        &state,
        exit_cleanup::ExitTrigger::ExitFallback,
        append_shutdown_log,
    );
}

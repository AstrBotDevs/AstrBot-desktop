use tauri::{AppHandle, Manager};

use crate::{navigate_main_window_to_backend, ui_dispatch, BackendState};

pub fn spawn_startup_task<F>(app_handle: AppHandle, startup_page_loaded: bool, log: F)
where
    F: Fn(&str) + Copy + Send + 'static,
{
    let startup_app_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        let startup_worker_handle = startup_app_handle.clone();
        let startup_result = tauri::async_runtime::spawn_blocking(move || {
            let state = startup_worker_handle.state::<BackendState>();
            state.ensure_backend_ready(&startup_worker_handle)
        })
        .await
        .map_err(|error| format!("Backend startup task failed: {error}"))
        .and_then(|result| result);

        if let Err(error) = ui_dispatch::run_on_main_thread_dispatch(
            &startup_app_handle,
            "present backend startup result",
            move |app| {
                let result = startup_result.and_then(|cache_version| {
                    navigate_main_window_to_backend(
                        app,
                        cache_version.as_deref(),
                        startup_page_loaded,
                    )
                });
                if let Err(error) = result {
                    ui_dispatch::show_startup_error(app, &error, startup_page_loaded, log);
                }
            },
        ) {
            log(&error);
        }
    });
}

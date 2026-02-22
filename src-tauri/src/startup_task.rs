use tauri::{AppHandle, Manager};

use crate::{navigate_main_window_to_backend, ui_dispatch, BackendState};

pub fn spawn_startup_task<F>(app_handle: AppHandle, log: F)
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

        match startup_result {
            Ok(()) => {
                if let Err(error) = ui_dispatch::run_on_main_thread_dispatch(
                    &startup_app_handle,
                    "navigate backend",
                    move |main_app| match navigate_main_window_to_backend(main_app) {
                        Ok(()) => {}
                        Err(navigate_error) => {
                            ui_dispatch::show_startup_error(main_app, &navigate_error, log);
                        }
                    },
                ) {
                    ui_dispatch::show_startup_error_on_main_thread(
                        &startup_app_handle,
                        &error,
                        log,
                    );
                }
            }
            Err(error) => {
                ui_dispatch::show_startup_error_on_main_thread(&startup_app_handle, &error, log);
            }
        }
    });
}

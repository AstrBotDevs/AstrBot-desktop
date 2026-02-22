use tauri::AppHandle;

pub fn run_on_main_thread_dispatch<F>(
    app_handle: &AppHandle,
    task_name: &str,
    mut task: F,
) -> Result<(), String>
where
    F: FnMut(&AppHandle) + Send + 'static,
{
    let app_handle_for_thread = app_handle.clone();
    app_handle
        .run_on_main_thread(move || {
            task(&app_handle_for_thread);
        })
        .map_err(|error| format!("Failed to dispatch '{task_name}' on main thread: {error}"))
}

pub fn show_startup_error<F>(app_handle: &AppHandle, message: &str, log: F)
where
    F: Fn(&str),
{
    log(&format!("startup error: {message}"));
    eprintln!("AstrBot startup failed: {message}");
    app_handle.exit(1);
}

pub fn show_startup_error_on_main_thread<F>(app_handle: &AppHandle, message: &str, log: F)
where
    F: Fn(&str) + Copy + Send + 'static,
{
    let message_owned = message.to_string();
    if let Err(error) =
        run_on_main_thread_dispatch(app_handle, "show startup error", move |main_app| {
            show_startup_error(main_app, &message_owned, log);
        })
    {
        log(&format!(
            "failed to dispatch startup error to main thread: {error}; original: {message}"
        ));
    }
}

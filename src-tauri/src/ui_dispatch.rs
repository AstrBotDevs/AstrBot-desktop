use tauri::{AppHandle, Manager};

fn startup_error_script(message: &str) -> String {
    let message_json = serde_json::to_string(message)
        .unwrap_or_else(|_| "\"AstrBot startup failed.\"".to_string());
    format!(
        "(() => {{ const message = {message_json}; window.__astrbotPendingStartupError = message; if (typeof window.__astrbotShowStartupError === 'function') {{ window.__astrbotShowStartupError(message); }} }})();"
    )
}

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
    let Some(window) = app_handle.get_webview_window("main") else {
        log("failed to display startup error: main window not found");
        app_handle.exit(1);
        return;
    };
    if let Err(error) = window.set_title("AstrBot - 启动失败 / Startup failed") {
        log(&format!(
            "failed to set startup error window title: {error}"
        ));
    }
    if let Err(error) = window.eval(startup_error_script(message)) {
        log(&format!(
            "failed to render startup error in startup shell: {error}"
        ));
    }
    if let Err(error) = window.unminimize() {
        log(&format!(
            "failed to unminimize startup error window: {error}"
        ));
    }
    if let Err(error) = window.show() {
        log(&format!("failed to show startup error window: {error}"));
    }
    if let Err(error) = window.set_focus() {
        log(&format!("failed to focus startup error window: {error}"));
    }
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

#[cfg(test)]
mod tests {
    use super::startup_error_script;

    #[test]
    fn startup_error_script_serializes_untrusted_messages_as_data() {
        let script = startup_error_script("stale \"WebUI\"\n</script>");

        assert!(script.contains("stale \\\"WebUI\\\"\\n</script>"));
        assert!(!script.contains("const message = stale"));
        assert!(script.contains("__astrbotPendingStartupError"));
        assert!(script.contains("__astrbotShowStartupError"));
    }
}

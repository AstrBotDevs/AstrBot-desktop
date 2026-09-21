use tauri::{AppHandle, Manager};

const PACKAGED_RESOURCE_ERROR_PREFIX: &str =
    "Packaged resources are unavailable for AstrBot Desktop ";
const STALE_WEBUI_ERROR_PREFIX: &str = "A different or stale AstrBot WebUI is already serving";

fn startup_error_is_repairable(message: &str) -> bool {
    message.starts_with(PACKAGED_RESOURCE_ERROR_PREFIX)
        || message.starts_with(STALE_WEBUI_ERROR_PREFIX)
}

fn startup_error_script(message: &str, repairable: bool) -> String {
    let message_json = serde_json::to_string(message)
        .unwrap_or_else(|_| "\"AstrBot startup failed.\"".to_string());
    format!(
        "(() => {{ const message = {message_json}; window.__astrbotPendingStartupError = message; window.__astrbotStartupRepairAvailable = {repairable}; if (typeof window.__astrbotShowStartupError === 'function') {{ window.__astrbotShowStartupError(message); }} }})();"
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
    let repairable = startup_error_is_repairable(message);
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
    if let Err(error) = window.eval(startup_error_script(message, repairable)) {
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
    use super::{startup_error_is_repairable, startup_error_script};

    #[test]
    fn only_packaged_resource_failures_offer_repair_install() {
        assert!(startup_error_is_repairable(
            "Packaged resources are unavailable for AstrBot Desktop 4.28.0. direct: mismatch"
        ));
        assert!(startup_error_is_repairable(
            "A different or stale AstrBot WebUI is already serving the Desktop port: expected digest"
        ));
        assert!(!startup_error_is_repairable(
            "Backend startup timed out while waiting for port 6185"
        ));
    }

    #[test]
    fn startup_error_script_serializes_untrusted_messages_as_data() {
        let script = startup_error_script("stale \"WebUI\"\n</script>", true);

        assert!(script.contains("stale \\\"WebUI\\\"\\n</script>"));
        assert!(!script.contains("const message = stale"));
        assert!(script.contains("__astrbotPendingStartupError"));
        assert!(script.contains("__astrbotShowStartupError"));
        assert!(script.contains("__astrbotStartupRepairAvailable = true"));
    }
}

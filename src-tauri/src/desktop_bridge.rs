use std::sync::OnceLock;

static DESKTOP_BRIDGE_BOOTSTRAP_TEMPLATE: &str = include_str!("bridge_bootstrap.js");
static DESKTOP_BRIDGE_BOOTSTRAP_SCRIPT: OnceLock<String> = OnceLock::new();

fn desktop_bridge_bootstrap_script(event_name: &str) -> &'static str {
    DESKTOP_BRIDGE_BOOTSTRAP_SCRIPT
        .get_or_init(|| {
            DESKTOP_BRIDGE_BOOTSTRAP_TEMPLATE.replace("{TRAY_RESTART_BACKEND_EVENT}", event_name)
        })
        .as_str()
}

pub fn inject_desktop_bridge<F>(webview: &tauri::Webview<tauri::Wry>, event_name: &str, log: F)
where
    F: Fn(&str),
{
    if let Err(error) = webview.eval(desktop_bridge_bootstrap_script(event_name)) {
        log(&format!("failed to inject desktop bridge script: {error}"));
    }
}

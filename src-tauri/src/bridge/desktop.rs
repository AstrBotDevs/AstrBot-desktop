use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use tauri::Manager;
use url::Url;

use crate::{bridge::origin_policy, TRAY_RESTART_BACKEND_EVENT};

static DESKTOP_BRIDGE_BOOTSTRAP_TEMPLATE: &str = include_str!("../bridge_bootstrap.js");
static DESKTOP_BRIDGE_CHAT_TRANSPORT_CONTRACT_TEMPLATE: &str =
    include_str!("../desktop_bridge_chat_transport_contract.json");
static DESKTOP_BRIDGE_BOOTSTRAP_SCRIPT: OnceLock<String> = OnceLock::new();
static DESKTOP_BRIDGE_CHAT_TRANSPORT_CONTRACT: OnceLock<DesktopBridgeChatTransportContract> =
    OnceLock::new();

#[derive(Default)]
pub(crate) struct StartupThemeWrites(Mutex<u64>);

impl StartupThemeWrites {
    pub(crate) fn advance(&self) {
        *self.0.lock().unwrap() += 1;
    }

    fn current(&self) -> u64 {
        *self.0.lock().unwrap()
    }

    pub(crate) fn save_current(
        &self,
        revision: u64,
        save: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        // Hold the revision lock through persistence so a reload cannot reorder writes.
        let current = self.0.lock().unwrap();
        if *current == revision {
            save()?;
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DesktopBridgeChatTransportContract {
    storage_key: String,
    websocket_value: String,
}

fn desktop_bridge_chat_transport_contract() -> &'static DesktopBridgeChatTransportContract {
    DESKTOP_BRIDGE_CHAT_TRANSPORT_CONTRACT.get_or_init(|| {
        let contract: DesktopBridgeChatTransportContract =
            serde_json::from_str(DESKTOP_BRIDGE_CHAT_TRANSPORT_CONTRACT_TEMPLATE)
                .expect("desktop bridge chat transport contract must be valid JSON");

        assert!(
            !contract.storage_key.is_empty(),
            "desktop bridge chat transport contract storageKey must be non-empty"
        );
        assert!(
            !contract.websocket_value.is_empty(),
            "desktop bridge chat transport contract websocketValue must be non-empty"
        );

        contract
    })
}

fn desktop_bridge_bootstrap_script() -> &'static str {
    DESKTOP_BRIDGE_BOOTSTRAP_SCRIPT
        .get_or_init(|| {
            let contract = desktop_bridge_chat_transport_contract();
            DESKTOP_BRIDGE_BOOTSTRAP_TEMPLATE
                .replace("{TRAY_RESTART_BACKEND_EVENT}", TRAY_RESTART_BACKEND_EVENT)
                .replace("{CHAT_TRANSPORT_MODE_STORAGE_KEY}", &contract.storage_key)
                .replace("{CHAT_TRANSPORT_MODE_WEBSOCKET}", &contract.websocket_value)
        })
        .as_str()
}

pub fn inject_desktop_bridge<F>(webview: &tauri::Webview<tauri::Wry>, log: F)
where
    F: Fn(&str),
{
    let revision = webview.app_handle().state::<StartupThemeWrites>().current();
    let script = desktop_bridge_bootstrap_script()
        .replace("{STARTUP_THEME_REVISION}", &revision.to_string());
    if let Err(error) = webview.eval(script) {
        log(&format!("failed to inject desktop bridge script: {error}"));
    }
}

pub fn should_inject_desktop_bridge(backend_url: &str, page_url: &Url) -> bool {
    let Ok(backend_url) = Url::parse(backend_url) else {
        return false;
    };
    origin_policy::tray_origin_decision(&backend_url, page_url).uses_backend_origin
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn older_dashboard_cannot_save_after_a_reload() {
        let writes = StartupThemeWrites::default();
        let old = writes.current();
        writes.advance();
        let new = writes.current();
        let mut persisted = None;

        writes
            .save_current(new, || {
                persisted = Some("light");
                Ok(())
            })
            .unwrap();
        writes
            .save_current(old, || {
                persisted = Some("dark");
                Ok(())
            })
            .unwrap();

        assert!(new > old);
        assert_eq!(persisted, Some("light"));
    }
}

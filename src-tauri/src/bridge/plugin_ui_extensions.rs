use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};

use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct PluginUiExtensionsBridgeState {
    pub(crate) enabled: bool,
    pub(crate) plugins: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub(crate) struct PluginUiExtensionGrantResult {
    pub(crate) granted: bool,
    pub(crate) reason: &'static str,
}

impl PluginUiExtensionGrantResult {
    pub(crate) fn granted() -> Self {
        Self {
            granted: true,
            reason: "granted",
        }
    }

    pub(crate) fn rejected(reason: &'static str) -> Self {
        Self {
            granted: false,
            reason,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PluginUiExtensionDecision {
    Invalid,
    Disabled,
    Granted,
    Declined,
    Busy,
    Prompt,
}

pub(crate) fn is_valid_plugin_name(plugin: &str) -> bool {
    let bytes = plugin.as_bytes();
    if bytes.is_empty() || bytes.len() > 128 {
        return false;
    }
    if !bytes[0].is_ascii_alphanumeric() && bytes[0] != b'_' {
        return false;
    }
    bytes[1..]
        .iter()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
}

pub(crate) fn decide_plugin_ui_extension_request(
    plugin: &str,
    enabled: bool,
    granted: bool,
    declined: bool,
    busy: bool,
) -> PluginUiExtensionDecision {
    if !is_valid_plugin_name(plugin) {
        return PluginUiExtensionDecision::Invalid;
    }
    if !enabled {
        return PluginUiExtensionDecision::Disabled;
    }
    if granted {
        return PluginUiExtensionDecision::Granted;
    }
    if declined {
        return PluginUiExtensionDecision::Declined;
    }
    if busy {
        return PluginUiExtensionDecision::Busy;
    }
    PluginUiExtensionDecision::Prompt
}

#[derive(Debug, Default)]
pub(crate) struct PluginUiExtensionRuntimeState {
    declined: Mutex<HashSet<String>>,
    prompt_open: Arc<AtomicBool>,
}

impl PluginUiExtensionRuntimeState {
    pub(crate) fn is_declined(&self, plugin: &str) -> bool {
        self.declined
            .lock()
            .expect("plugin UI extension declined lock")
            .contains(plugin)
    }

    pub(crate) fn mark_declined(&self, plugin: &str) {
        self.declined
            .lock()
            .expect("plugin UI extension declined lock")
            .insert(plugin.to_string());
    }

    pub(crate) fn is_prompt_open(&self) -> bool {
        self.prompt_open.load(Ordering::Acquire)
    }

    pub(crate) fn try_acquire_prompt(&self) -> Option<PluginUiExtensionPromptGuard> {
        self.prompt_open
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .ok()?;
        Some(PluginUiExtensionPromptGuard {
            flag: Arc::clone(&self.prompt_open),
        })
    }
}

#[derive(Debug)]
pub(crate) struct PluginUiExtensionPromptGuard {
    flag: Arc<AtomicBool>,
}

impl Drop for PluginUiExtensionPromptGuard {
    fn drop(&mut self) {
        self.flag.store(false, Ordering::Release);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_name_accepts_ascii_boundaries() {
        assert!(is_valid_plugin_name("a"));
        assert!(is_valid_plugin_name("_palette-0.5.9"));
        assert!(is_valid_plugin_name(&"a".repeat(128)));
    }

    #[test]
    fn plugin_name_rejects_invalid_boundaries_and_characters() {
        assert!(!is_valid_plugin_name(""));
        assert!(!is_valid_plugin_name(".palette"));
        assert!(!is_valid_plugin_name("-palette"));
        assert!(!is_valid_plugin_name("a/b"));
        assert!(!is_valid_plugin_name("a b"));
        assert!(!is_valid_plugin_name("调色盘"));
        assert!(!is_valid_plugin_name(&"a".repeat(129)));
    }

    #[test]
    fn request_decision_covers_every_short_circuit() {
        assert_eq!(
            decide_plugin_ui_extension_request("bad/name", false, true, true, true),
            PluginUiExtensionDecision::Invalid
        );
        assert_eq!(
            decide_plugin_ui_extension_request("palette", false, true, true, true),
            PluginUiExtensionDecision::Disabled
        );
        assert_eq!(
            decide_plugin_ui_extension_request("palette", true, true, true, true),
            PluginUiExtensionDecision::Granted
        );
        assert_eq!(
            decide_plugin_ui_extension_request("palette", true, false, true, true),
            PluginUiExtensionDecision::Declined
        );
        assert_eq!(
            decide_plugin_ui_extension_request("palette", true, false, false, true),
            PluginUiExtensionDecision::Busy
        );
        assert_eq!(
            decide_plugin_ui_extension_request("palette", true, false, false, false),
            PluginUiExtensionDecision::Prompt
        );
    }

    #[test]
    fn declined_state_is_scoped_to_plugin_name() {
        let state = PluginUiExtensionRuntimeState::default();
        state.mark_declined("palette");

        assert!(state.is_declined("palette"));
        assert!(!state.is_declined("other"));
    }

    #[test]
    fn prompt_guard_allows_only_one_dialog_and_releases_on_drop() {
        let state = PluginUiExtensionRuntimeState::default();
        let guard = state.try_acquire_prompt().expect("first prompt");

        assert!(state.is_prompt_open());
        assert!(state.try_acquire_prompt().is_none());
        drop(guard);
        assert!(!state.is_prompt_open());
        assert!(state.try_acquire_prompt().is_some());
    }
}

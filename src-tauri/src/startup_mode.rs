use std::path::Path;

// Keep in sync with STARTUP_MODES in ui/index.html.
pub const STARTUP_MODE_LOADING: &str = "loading";
pub const STARTUP_MODE_PANEL_UPDATE: &str = "panel-update";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartupMode {
    Loading,
    PanelUpdate,
}

impl StartupMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Loading => STARTUP_MODE_LOADING,
            Self::PanelUpdate => STARTUP_MODE_PANEL_UPDATE,
        }
    }
}

pub fn resolve_mode_from_env(raw_mode: &str, env_name: &str) -> (StartupMode, Option<String>) {
    let normalized = raw_mode.trim();
    if normalized.eq_ignore_ascii_case(STARTUP_MODE_PANEL_UPDATE) {
        return (
            StartupMode::PanelUpdate,
            Some("startup mode forced to panel-update by env".to_string()),
        );
    }
    if !normalized.is_empty() && !normalized.eq_ignore_ascii_case(STARTUP_MODE_LOADING) {
        return (
            StartupMode::Loading,
            Some(format!(
                "invalid startup mode in {env_name}: {normalized}, fallback to loading"
            )),
        );
    }
    (StartupMode::Loading, None)
}

pub fn resolve_mode_from_webui_dir(webui_dir: Option<&Path>) -> (StartupMode, Option<String>) {
    match webui_dir {
        Some(webui_dir) => {
            let webui_index = webui_dir.join("index.html");
            if !webui_index.is_file() {
                (
                    StartupMode::PanelUpdate,
                    Some(format!(
                        "startup mode set to panel-update: webui index is unavailable at {}",
                        webui_dir.display()
                    )),
                )
            } else {
                (StartupMode::Loading, None)
            }
        }
        None => (
            StartupMode::PanelUpdate,
            Some("startup mode set to panel-update: launch plan does not provide webui_dir".into()),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_mode_from_env_accepts_panel_update_case_insensitive() {
        let (mode, message) = resolve_mode_from_env("Panel-Update", "TEST_ENV");
        assert_eq!(mode, StartupMode::PanelUpdate);
        assert!(message
            .expect("expected panel-update env message")
            .contains("forced to panel-update"));
    }

    #[test]
    fn resolve_mode_from_env_rejects_unknown_values() {
        let (mode, message) = resolve_mode_from_env("foo", "TEST_ENV");
        assert_eq!(mode, StartupMode::Loading);
        assert!(message
            .expect("expected invalid env warning")
            .contains("invalid startup mode"));
    }
}

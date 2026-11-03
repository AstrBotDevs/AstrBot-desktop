use std::{fs, io::Write, path::Path, sync::Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug)]
pub(crate) struct DesktopSettingsCache {
    settings: Mutex<DesktopSettings>,
}

impl DesktopSettingsCache {
    pub(crate) fn new(settings: DesktopSettings) -> Self {
        Self {
            settings: Mutex::new(settings),
        }
    }

    pub(crate) fn get(&self) -> DesktopSettings {
        self.settings
            .lock()
            .expect("desktop settings cache lock")
            .clone()
    }

    pub(crate) fn update(
        &self,
        persist: impl FnOnce() -> Result<DesktopSettings, String>,
    ) -> Result<(), String> {
        let mut settings = self.settings.lock().expect("desktop settings cache lock");
        *settings = persist()?;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DesktopSettingKey {
    LaunchAtLogin,
    SilentLaunch,
    CloseToTray,
    PluginUiExtensions,
}

fn default_launch_at_login() -> bool {
    false
}

fn default_silent_launch() -> bool {
    false
}

fn default_close_to_tray() -> bool {
    true
}

fn default_plugin_ui_extensions_enabled() -> bool {
    true
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub(crate) struct DesktopSettings {
    #[serde(rename = "launchAtLogin", default = "default_launch_at_login")]
    pub(crate) launch_at_login: bool,
    #[serde(rename = "silentLaunch", default = "default_silent_launch")]
    pub(crate) silent_launch: bool,
    #[serde(rename = "closeToTray", default = "default_close_to_tray")]
    pub(crate) close_to_tray: bool,
    #[serde(
        rename = "pluginUiExtensionsEnabled",
        default = "default_plugin_ui_extensions_enabled"
    )]
    pub(crate) plugin_ui_extensions_enabled: bool,
    #[serde(rename = "pluginUiExtensionGrants", default)]
    pub(crate) plugin_ui_extension_grants: Vec<String>,
    #[serde(flatten)]
    other: Map<String, Value>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            launch_at_login: default_launch_at_login(),
            silent_launch: default_silent_launch(),
            close_to_tray: default_close_to_tray(),
            plugin_ui_extensions_enabled: default_plugin_ui_extensions_enabled(),
            plugin_ui_extension_grants: Vec::new(),
            other: Map::new(),
        }
    }
}

impl DesktopSettings {
    fn set(&mut self, key: DesktopSettingKey, value: bool) {
        match key {
            DesktopSettingKey::LaunchAtLogin => self.launch_at_login = value,
            DesktopSettingKey::SilentLaunch => self.silent_launch = value,
            DesktopSettingKey::CloseToTray => self.close_to_tray = value,
            DesktopSettingKey::PluginUiExtensions => self.plugin_ui_extensions_enabled = value,
        }
    }
}

fn load_state(path: &Path) -> Result<DesktopSettings, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DesktopSettings::default());
        }
        Err(error) => {
            return Err(format!(
                "Failed to read desktop settings state {}: {}",
                path.display(),
                error
            ));
        }
    };

    match serde_json::from_str::<DesktopSettings>(&raw) {
        Ok(state) => Ok(state),
        Err(error) => {
            crate::append_desktop_log(&format!(
                "failed to parse desktop settings state {}: {}. resetting state file",
                path.display(),
                error
            ));
            let default_state = DesktopSettings::default();
            if let Err(save_error) = save_state(path, &default_state) {
                crate::append_desktop_log(&format!(
                    "failed to persist reset desktop settings state {}: {}",
                    path.display(),
                    save_error
                ));
            }
            Ok(default_state)
        }
    }
}

fn ensure_parent_dir(path: &Path) -> Result<(), String> {
    if let Some(parent_dir) = path.parent() {
        fs::create_dir_all(parent_dir).map_err(|error| {
            format!(
                "Failed to create desktop settings directory {}: {}",
                parent_dir.display(),
                error
            )
        })?;
    }

    Ok(())
}

fn save_state(path: &Path, state: &DesktopSettings) -> Result<(), String> {
    ensure_parent_dir(path)?;

    let serialized = serde_json::to_string_pretty(state)
        .map_err(|error| format!("Failed to serialize desktop settings state: {error}"))?;
    let tmp_name = format!(
        "{}.tmp",
        path.file_name()
            .map(|value| value.to_string_lossy())
            .unwrap_or_default()
    );
    let tmp_path = path.with_file_name(tmp_name);

    let mut file = fs::File::create(&tmp_path).map_err(|error| {
        format!(
            "Failed to create temporary desktop settings state file {}: {}",
            tmp_path.display(),
            error
        )
    })?;
    file.write_all(serialized.as_bytes())
        .and_then(|_| file.sync_all())
        .map_err(|error| {
            format!(
                "Failed to write temporary desktop settings state file {}: {}",
                tmp_path.display(),
                error
            )
        })?;
    fs::rename(&tmp_path, path).map_err(|error| {
        format!(
            "Failed to atomically replace desktop settings state file {}: {}",
            path.display(),
            error
        )
    })
}

pub(crate) fn read_desktop_settings(packaged_root_dir: Option<&Path>) -> DesktopSettings {
    let _state_guard = crate::desktop_state::lock_desktop_state();
    let Some(state_path) = crate::desktop_state::resolve_desktop_state_path(packaged_root_dir)
    else {
        return DesktopSettings::default();
    };

    match load_state(&state_path) {
        Ok(state) => state,
        Err(error) => {
            crate::append_desktop_log(&error);
            DesktopSettings::default()
        }
    }
}

pub(crate) fn write_desktop_setting(
    packaged_root_dir: Option<&Path>,
    key: DesktopSettingKey,
    value: bool,
) -> Result<DesktopSettings, String> {
    let _state_guard = crate::desktop_state::lock_desktop_state();
    let Some(state_path) = crate::desktop_state::resolve_desktop_state_path(packaged_root_dir)
    else {
        let message =
            "Desktop settings state path is unavailable; cannot persist setting.".to_string();
        crate::append_desktop_log(&message);
        return Err(message);
    };

    let mut state = load_state(&state_path)?;
    state.set(key, value);
    save_state(&state_path, &state)?;
    Ok(state)
}

pub(crate) fn grant_plugin_ui_extension(
    packaged_root_dir: Option<&Path>,
    plugin: &str,
) -> Result<DesktopSettings, String> {
    let _state_guard = crate::desktop_state::lock_desktop_state();
    let Some(state_path) = crate::desktop_state::resolve_desktop_state_path(packaged_root_dir)
    else {
        let message =
            "Desktop settings state path is unavailable; cannot persist plugin UI extension grant."
                .to_string();
        crate::append_desktop_log(&message);
        return Err(message);
    };

    let mut state = load_state(&state_path)?;
    state.plugin_ui_extension_grants.push(plugin.to_string());
    state.plugin_ui_extension_grants.sort();
    state.plugin_ui_extension_grants.dedup();
    save_state(&state_path, &state)?;
    Ok(state)
}

pub(crate) fn clear_plugin_ui_extension_grants(
    packaged_root_dir: Option<&Path>,
) -> Result<DesktopSettings, String> {
    let _state_guard = crate::desktop_state::lock_desktop_state();
    let Some(state_path) = crate::desktop_state::resolve_desktop_state_path(packaged_root_dir)
    else {
        let message =
            "Desktop settings state path is unavailable; cannot clear plugin UI extension grants."
                .to_string();
        crate::append_desktop_log(&message);
        return Err(message);
    };

    let mut state = load_state(&state_path)?;
    state.plugin_ui_extension_grants.clear();
    save_state(&state_path, &state)?;
    Ok(state)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf};

    use super::*;

    fn create_temp_case_dir(name: &str) -> PathBuf {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "astrbot-desktop-settings-test-{}-{}-{}",
            std::process::id(),
            name,
            ts
        ))
    }

    fn state_path(root: &std::path::Path) -> PathBuf {
        root.join("data").join("desktop_state.json")
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<String>,
        _root_guard: std::sync::MutexGuard<'static, ()>,
    }

    impl EnvVarGuard {
        fn clear(key: &'static str) -> Self {
            let guard = crate::desktop_state::ROOT_ENV_TEST_LOCK.lock().unwrap();
            let previous = std::env::var(key).ok();
            std::env::remove_var(key);
            Self {
                key,
                previous,
                _root_guard: guard,
            }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => std::env::set_var(self.key, value),
                None => std::env::remove_var(self.key),
            }
        }
    }

    fn settings(
        launch_at_login: bool,
        silent_launch: bool,
        close_to_tray: bool,
    ) -> DesktopSettings {
        DesktopSettings {
            launch_at_login,
            silent_launch,
            close_to_tray,
            ..DesktopSettings::default()
        }
    }

    #[test]
    fn desktop_settings_default_preserves_existing_close_to_tray_behavior() {
        assert_eq!(DesktopSettings::default(), settings(false, false, true));
    }

    #[test]
    fn read_desktop_settings_maps_camel_case_fields() {
        let _root_guard = EnvVarGuard::clear(crate::ASTRBOT_ROOT_ENV);
        let root = create_temp_case_dir("read");
        let path = state_path(&root);
        fs::create_dir_all(path.parent().expect("state parent")).expect("create state parent");
        fs::write(
            &path,
            r#"{"launchAtLogin":true,"silentLaunch":true,"closeToTray":false}"#,
        )
        .expect("write state");

        assert_eq!(
            read_desktop_settings(Some(&root)),
            settings(true, true, false)
        );
    }

    #[test]
    fn read_desktop_settings_applies_field_defaults_for_missing_values() {
        let _root_guard = EnvVarGuard::clear(crate::ASTRBOT_ROOT_ENV);
        let root = create_temp_case_dir("defaults");
        let path = state_path(&root);
        fs::create_dir_all(path.parent().expect("state parent")).expect("create state parent");
        fs::write(&path, r#"{"silentLaunch":true}"#).expect("write state");

        assert_eq!(
            read_desktop_settings(Some(&root)),
            settings(false, true, true)
        );
    }

    #[test]
    fn desktop_settings_cache_returns_updated_value_without_reloading_file() {
        let cache = DesktopSettingsCache::new(DesktopSettings::default());
        let updated = settings(true, true, false);

        cache.update(|| Ok(updated.clone())).expect("update cache");

        assert_eq!(cache.get(), updated);
    }

    #[test]
    fn cache_keeps_previous_settings_when_persistence_fails() {
        let previous = settings(true, false, false);
        let cache = DesktopSettingsCache::new(previous.clone());
        assert_eq!(
            cache.update(|| Err("write failed".to_string())),
            Err("write failed".to_string())
        );
        assert_eq!(cache.get(), previous);
    }

    #[test]
    fn concurrent_cache_updates_publish_in_persistence_order() {
        let _root_guard = EnvVarGuard::clear(crate::ASTRBOT_ROOT_ENV);
        let root = tempfile::tempdir().unwrap();
        let cache = DesktopSettingsCache::new(DesktopSettings::default());
        let (persisted_tx, persisted_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        std::thread::scope(|scope| {
            let cache_ref = &cache;
            let root_path = root.path();
            let first = scope.spawn(move || {
                cache_ref.update(|| {
                    let updated = grant_plugin_ui_extension(Some(root_path), "palette")?;
                    persisted_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Ok(updated)
                })
            });
            persisted_rx.recv().unwrap();
            let second = scope.spawn(|| {
                started_tx.send(()).unwrap();
                cache.update(|| {
                    entered_tx.send(()).unwrap();
                    write_desktop_setting(
                        Some(root.path()),
                        DesktopSettingKey::PluginUiExtensions,
                        false,
                    )
                })
            });
            started_rx.recv().unwrap();
            let entered_early = entered_rx.recv_timeout(std::time::Duration::from_millis(50));
            release_tx.send(()).unwrap();
            first.join().unwrap().unwrap();
            second.join().unwrap().unwrap();
            assert_eq!(
                entered_early,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout)
            );
        });
        let current = cache.get();
        assert!(!current.plugin_ui_extensions_enabled);
        assert_eq!(
            current.plugin_ui_extension_grants,
            vec!["palette".to_string()]
        );
        assert_eq!(current, read_desktop_settings(Some(root.path())));
    }

    #[test]
    fn write_desktop_setting_preserves_unknown_fields() {
        let _root_guard = EnvVarGuard::clear(crate::ASTRBOT_ROOT_ENV);
        let root = create_temp_case_dir("preserve");
        let path = state_path(&root);
        fs::create_dir_all(path.parent().expect("state parent")).expect("create state parent");
        fs::write(
            &path,
            r#"{"locale":"zh-CN","updateChannel":"nightly","silentLaunch":false}"#,
        )
        .expect("write state");

        let updated = write_desktop_setting(Some(&root), DesktopSettingKey::SilentLaunch, true)
            .expect("write setting");

        assert!(updated.silent_launch);
        let raw = fs::read_to_string(&path).expect("read state");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse state");
        assert_eq!(
            parsed.get("locale").and_then(|value| value.as_str()),
            Some("zh-CN")
        );
        assert_eq!(
            parsed.get("updateChannel").and_then(|value| value.as_str()),
            Some("nightly")
        );
        assert_eq!(
            parsed.get("silentLaunch").and_then(|value| value.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn invalid_state_falls_back_to_defaults_and_write_resets_object() {
        let _root_guard = EnvVarGuard::clear(crate::ASTRBOT_ROOT_ENV);
        let root = create_temp_case_dir("invalid");
        let path = state_path(&root);
        fs::create_dir_all(path.parent().expect("state parent")).expect("create state parent");
        fs::write(&path, "not-json").expect("write invalid state");

        assert_eq!(
            read_desktop_settings(Some(&root)),
            DesktopSettings::default()
        );

        let updated = write_desktop_setting(Some(&root), DesktopSettingKey::CloseToTray, false)
            .expect("write setting");

        assert!(!updated.close_to_tray);
        let raw = fs::read_to_string(&path).expect("read state");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse reset state");
        assert_eq!(
            parsed.get("closeToTray").and_then(|value| value.as_bool()),
            Some(false)
        );
    }

    #[test]
    fn plugin_ui_extensions_default_to_enabled_without_any_grants() {
        let settings = DesktopSettings::default();

        assert!(settings.plugin_ui_extensions_enabled);
        assert!(settings.plugin_ui_extension_grants.is_empty());
    }

    #[test]
    fn plugin_ui_extension_grants_roundtrip_sorted_and_preserves_unknown_fields() {
        let _root_guard = EnvVarGuard::clear(crate::ASTRBOT_ROOT_ENV);
        let root = tempfile::tempdir().expect("temp root");
        let path = state_path(root.path());
        fs::create_dir_all(path.parent().expect("state parent")).expect("create state parent");
        fs::write(&path, r#"{"locale":"zh-CN"}"#).expect("write state");

        grant_plugin_ui_extension(Some(root.path()), "zeta_plugin").expect("grant zeta");
        let updated =
            grant_plugin_ui_extension(Some(root.path()), "alpha_plugin").expect("grant alpha");
        let duplicate =
            grant_plugin_ui_extension(Some(root.path()), "alpha_plugin").expect("duplicate grant");

        assert_eq!(
            updated.plugin_ui_extension_grants,
            vec!["alpha_plugin".to_string(), "zeta_plugin".to_string()]
        );
        assert_eq!(
            duplicate.plugin_ui_extension_grants,
            updated.plugin_ui_extension_grants
        );
        assert_eq!(read_desktop_settings(Some(root.path())), duplicate);
        let raw = fs::read_to_string(path).expect("read state");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse state");
        assert_eq!(
            parsed.get("locale").and_then(|value| value.as_str()),
            Some("zh-CN")
        );
        assert_eq!(
            parsed
                .get("pluginUiExtensionsEnabled")
                .and_then(|value| value.as_bool()),
            Some(true)
        );
    }

    #[test]
    fn clearing_plugin_ui_extension_grants_does_not_change_master_switch() {
        let _root_guard = EnvVarGuard::clear(crate::ASTRBOT_ROOT_ENV);
        let root = tempfile::tempdir().expect("temp root");
        grant_plugin_ui_extension(Some(root.path()), "palette").expect("grant plugin");
        write_desktop_setting(
            Some(root.path()),
            DesktopSettingKey::PluginUiExtensions,
            false,
        )
        .expect("disable extensions");

        let updated = clear_plugin_ui_extension_grants(Some(root.path())).expect("clear grants");

        assert!(updated.plugin_ui_extension_grants.is_empty());
        assert!(!updated.plugin_ui_extensions_enabled);
        assert_eq!(read_desktop_settings(Some(root.path())), updated);
    }

    #[test]
    fn concurrent_state_writers_preserve_grants_switch_locale_and_channel() {
        let _root_guard = EnvVarGuard::clear(crate::ASTRBOT_ROOT_ENV);
        let root = tempfile::tempdir().expect("temp root");
        let path = state_path(root.path());
        fs::create_dir_all(path.parent().expect("state parent")).unwrap();
        fs::write(&path, r#"{"unrelated":42}"#).unwrap();
        let start = std::sync::Barrier::new(4);
        std::thread::scope(|scope| {
            let grant = scope.spawn(|| {
                start.wait();
                for index in 0..24 {
                    grant_plugin_ui_extension(Some(root.path()), &format!("plugin_{index:02}"))?;
                }
                Ok::<_, String>(())
            });
            let toggle = scope.spawn(|| {
                start.wait();
                for _ in 0..24 {
                    write_desktop_setting(
                        Some(root.path()),
                        DesktopSettingKey::PluginUiExtensions,
                        false,
                    )?;
                }
                Ok::<_, String>(())
            });
            let locale = scope.spawn(|| {
                start.wait();
                for _ in 0..24 {
                    crate::shell_locale::write_cached_shell_locale(
                        Some("en-US"),
                        Some(root.path()),
                    )?;
                }
                Ok::<_, String>(())
            });
            let channel = scope.spawn(|| {
                start.wait();
                for _ in 0..24 {
                    crate::update_channel::write_cached_update_channel(
                        Some(crate::update_channel::UpdateChannel::Nightly),
                        Some(root.path()),
                    )?;
                }
                Ok::<_, String>(())
            });
            for thread in [grant, toggle, locale, channel] {
                thread.join().unwrap().expect("concurrent state write");
            }
        });
        let settings = read_desktop_settings(Some(root.path()));
        assert!(!settings.plugin_ui_extensions_enabled);
        assert_eq!(
            settings.plugin_ui_extension_grants,
            (0..24)
                .map(|index| format!("plugin_{index:02}"))
                .collect::<Vec<_>>()
        );
        let parsed: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(parsed["locale"], "en-US");
        assert_eq!(parsed["updateChannel"], "nightly");
        assert_eq!(parsed["unrelated"], 42);
    }

    #[test]
    fn invalid_state_is_rewritten_to_defaults_on_read() {
        let _root_guard = EnvVarGuard::clear(crate::ASTRBOT_ROOT_ENV);
        let root = create_temp_case_dir("invalid-read-reset");
        let path = state_path(&root);
        fs::create_dir_all(path.parent().expect("state parent")).expect("create state parent");
        fs::write(&path, "not-json").expect("write invalid state");

        assert_eq!(
            read_desktop_settings(Some(&root)),
            DesktopSettings::default()
        );

        let raw = fs::read_to_string(&path).expect("read reset state");
        let parsed: serde_json::Value = serde_json::from_str(&raw).expect("parse reset state");
        assert_eq!(
            parsed
                .get("launchAtLogin")
                .and_then(|value| value.as_bool()),
            Some(false)
        );
        assert_eq!(
            parsed.get("silentLaunch").and_then(|value| value.as_bool()),
            Some(false)
        );
        assert_eq!(
            parsed.get("closeToTray").and_then(|value| value.as_bool()),
            Some(true)
        );
    }
}

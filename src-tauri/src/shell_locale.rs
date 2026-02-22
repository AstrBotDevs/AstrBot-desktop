use std::{
    env, fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Clone, Copy)]
pub struct ShellTexts {
    pub tray_hide: &'static str,
    pub tray_show: &'static str,
    pub tray_reload: &'static str,
    pub tray_restart_backend: &'static str,
    pub tray_quit: &'static str,
}

pub fn shell_texts_for_locale(locale: &str) -> ShellTexts {
    if locale == "en-US" {
        return ShellTexts {
            tray_hide: "Hide AstrBot",
            tray_show: "Show AstrBot",
            tray_reload: "Reload",
            tray_restart_backend: "Restart Backend",
            tray_quit: "Quit",
        };
    }

    ShellTexts {
        tray_hide: "隐藏 AstrBot",
        tray_show: "显示 AstrBot",
        tray_reload: "重新加载",
        tray_restart_backend: "重启后端",
        tray_quit: "退出",
    }
}

pub fn resolve_shell_locale(
    default_shell_locale: &'static str,
    packaged_root_dir: Option<PathBuf>,
) -> &'static str {
    if let Some(locale) = read_cached_shell_locale(packaged_root_dir.as_deref()) {
        return locale;
    }

    for env_key in ["ASTRBOT_DESKTOP_LOCALE", "LC_ALL", "LANG"] {
        if let Ok(value) = env::var(env_key) {
            if let Some(locale) = normalize_shell_locale(&value) {
                return locale;
            }
        }
    }

    default_shell_locale
}

fn normalize_shell_locale(raw: &str) -> Option<&'static str> {
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if raw == "zh-CN" {
        return Some("zh-CN");
    }
    if raw == "en-US" {
        return Some("en-US");
    }

    let lowered = raw.to_ascii_lowercase();
    if lowered.starts_with("zh") {
        return Some("zh-CN");
    }
    if lowered.starts_with("en") {
        return Some("en-US");
    }
    None
}

fn desktop_state_path_for_locale(packaged_root_dir: Option<&Path>) -> Option<PathBuf> {
    if let Ok(root) = env::var("ASTRBOT_ROOT") {
        let path = PathBuf::from(root.trim());
        if !path.as_os_str().is_empty() {
            return Some(path.join("data").join("desktop_state.json"));
        }
    }

    packaged_root_dir.map(|root| root.join("data").join("desktop_state.json"))
}

fn read_cached_shell_locale(packaged_root_dir: Option<&Path>) -> Option<&'static str> {
    let state_path = desktop_state_path_for_locale(packaged_root_dir)?;
    let raw = fs::read_to_string(state_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let locale = parsed.get("locale")?.as_str()?;
    normalize_shell_locale(locale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shell_texts_for_locale_returns_english_copy() {
        let texts = shell_texts_for_locale("en-US");
        assert_eq!(texts.tray_hide, "Hide AstrBot");
        assert_eq!(texts.tray_quit, "Quit");
    }

    #[test]
    fn shell_texts_for_locale_falls_back_to_zh_cn_copy() {
        let texts = shell_texts_for_locale("zh-CN");
        assert_eq!(texts.tray_hide, "隐藏 AstrBot");
        assert_eq!(texts.tray_quit, "退出");
    }

    #[test]
    fn normalize_shell_locale_accepts_language_prefixes() {
        assert_eq!(normalize_shell_locale("EN_us"), Some("en-US"));
        assert_eq!(normalize_shell_locale("zh_TW"), Some("zh-CN"));
        assert_eq!(normalize_shell_locale("fr-FR"), None);
    }
}

use std::{env, fs, path::Path};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{Duration, Utc};
use ring::hmac;
use serde::Serialize;
use serde_json::Value;

const CMD_CONFIG_RELATIVE_PATH: &str = "data/cmd_config.json";
const JWT_LIFETIME_DAYS: i64 = 7;

#[derive(Debug, Serialize)]
pub(crate) struct DesktopAuthSessionResult {
    pub(crate) ok: bool,
    pub(crate) reason: Option<String>,
    pub(crate) token: Option<String>,
    pub(crate) username: Option<String>,
}

impl DesktopAuthSessionResult {
    fn error(reason: impl Into<String>) -> Self {
        Self {
            ok: false,
            reason: Some(reason.into()),
            token: None,
            username: None,
        }
    }
}

fn encode_segment(value: &Value) -> Result<String, String> {
    serde_json::to_vec(value)
        .map(|bytes| URL_SAFE_NO_PAD.encode(bytes))
        .map_err(|error| format!("Failed to encode desktop JWT: {error}"))
}

fn sign_jwt(username: &str, jwt_secret: &str) -> Result<String, String> {
    let header = encode_segment(&serde_json::json!({"alg": "HS256", "typ": "JWT"}))?;
    let expires_at = Utc::now()
        .checked_add_signed(Duration::days(JWT_LIFETIME_DAYS))
        .ok_or_else(|| "Failed to calculate desktop JWT expiry.".to_string())?
        .timestamp();
    let payload = encode_segment(&serde_json::json!({
        "username": username,
        "exp": expires_at,
    }))?;
    let signing_input = format!("{header}.{payload}");
    let key = hmac::Key::new(hmac::HMAC_SHA256, jwt_secret.as_bytes());
    let signature = hmac::sign(&key, signing_input.as_bytes());
    Ok(format!(
        "{signing_input}.{}",
        URL_SAFE_NO_PAD.encode(signature.as_ref())
    ))
}

fn read_session_from_root(root_dir: &Path) -> DesktopAuthSessionResult {
    let config_path = root_dir.join(CMD_CONFIG_RELATIVE_PATH);
    let config_text = match fs::read_to_string(&config_path) {
        Ok(value) => value,
        Err(error) => {
            return DesktopAuthSessionResult::error(format!(
                "Dashboard configuration is not ready: {error}"
            ))
        }
    };
    let config: Value = match serde_json::from_str(config_text.trim_start_matches('\u{feff}')) {
        Ok(value) => value,
        Err(error) => {
            return DesktopAuthSessionResult::error(format!(
                "Invalid dashboard configuration: {error}"
            ))
        }
    };
    let dashboard = &config["dashboard"];
    let username = dashboard["username"].as_str().unwrap_or_default().trim();
    let jwt_secret = dashboard["jwt_secret"].as_str().unwrap_or_default();
    if username.is_empty() || jwt_secret.trim().is_empty() {
        return DesktopAuthSessionResult::error("Dashboard authentication is not ready.");
    }

    match sign_jwt(username, jwt_secret) {
        Ok(token) => DesktopAuthSessionResult {
            ok: true,
            reason: None,
            token: Some(token),
            username: Some(username.to_string()),
        },
        Err(error) => DesktopAuthSessionResult::error(error),
    }
}

pub(crate) fn create_desktop_auth_session() -> DesktopAuthSessionResult {
    let root_dir = env::var(crate::ASTRBOT_ROOT_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(std::path::PathBuf::from)
        .or_else(crate::runtime_paths::default_packaged_root_dir);
    match root_dir {
        Some(root_dir) => read_session_from_root(&root_dir),
        None => DesktopAuthSessionResult::error("Cannot resolve the AstrBot data directory."),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_a_valid_hs256_session_from_dashboard_config() {
        let root = tempfile::tempdir().expect("temporary AstrBot root");
        let data_dir = root.path().join("data");
        fs::create_dir_all(&data_dir).expect("create data directory");
        fs::write(
            data_dir.join("cmd_config.json"),
            r#"{"dashboard":{"username":"astrbot","jwt_secret":" desktop-secret "}}"#,
        )
        .expect("write dashboard config");

        let result = read_session_from_root(root.path());
        assert!(result.ok);
        assert_eq!(result.username.as_deref(), Some("astrbot"));

        let token = result.token.expect("desktop token");
        let segments = token.split('.').collect::<Vec<_>>();
        assert_eq!(segments.len(), 3);
        let signing_input = format!("{}.{}", segments[0], segments[1]);
        let signature = URL_SAFE_NO_PAD
            .decode(segments[2])
            .expect("decode signature");
        let key = hmac::Key::new(hmac::HMAC_SHA256, b" desktop-secret ");
        hmac::verify(&key, signing_input.as_bytes(), &signature).expect("valid signature");
    }

    #[test]
    fn rejects_config_without_a_jwt_secret() {
        let root = tempfile::tempdir().expect("temporary AstrBot root");
        let data_dir = root.path().join("data");
        fs::create_dir_all(&data_dir).expect("create data directory");
        fs::write(
            data_dir.join("cmd_config.json"),
            r#"{"dashboard":{"username":"astrbot","jwt_secret":""}}"#,
        )
        .expect("write dashboard config");

        let result = read_session_from_root(root.path());
        assert!(!result.ok);
        assert!(result.token.is_none());
    }
}

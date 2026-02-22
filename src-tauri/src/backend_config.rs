use std::env;
use std::time::Duration;

pub fn resolve_backend_ready_http_path<F>(env_name: &str, default_path: &str, mut log: F) -> String
where
    F: FnMut(String),
{
    match env::var_os(env_name) {
        Some(raw) => match raw.to_str() {
            Some(raw_utf8) => {
                let trimmed = raw_utf8.trim();
                if trimmed.is_empty() {
                    log(format!(
                        "{env_name} is empty/whitespace, fallback to default '{default_path}'"
                    ));
                    default_path.to_string()
                } else if trimmed.starts_with('/') {
                    trimmed.to_string()
                } else {
                    let normalized = format!("/{trimmed}");
                    log(format!(
                        "{env_name} is missing leading '/': '{trimmed}', normalized to '{normalized}'"
                    ));
                    normalized
                }
            }
            None => {
                log(format!(
                    "{env_name} contains non-UTF-8 value '{}', fallback to default '{default_path}'",
                    raw.to_string_lossy()
                ));
                default_path.to_string()
            }
        },
        None => default_path.to_string(),
    }
}

pub fn parse_clamped_timeout_env<F>(
    raw: &str,
    env_name: &str,
    fallback_ms: u64,
    min_ms: u64,
    max_ms: u64,
    mut log: F,
) -> u64
where
    F: FnMut(String),
{
    match raw.trim().parse::<u128>() {
        Ok(parsed) if parsed > 0 => {
            if parsed < min_ms as u128 {
                log(format!(
                    "{}='{}' is below minimum {}ms, clamped to {}ms",
                    env_name, raw, min_ms, min_ms
                ));
                min_ms
            } else if parsed > max_ms as u128 {
                log(format!(
                    "{}='{}' is above maximum {}ms, clamped to {}ms",
                    env_name, raw, max_ms, max_ms
                ));
                max_ms
            } else {
                parsed as u64
            }
        }
        _ => {
            log(format!(
                "invalid {}='{}', fallback to {}ms",
                env_name, raw, fallback_ms
            ));
            fallback_ms
        }
    }
}

pub fn parse_ping_timeout_env<F>(
    raw: &str,
    env_name: &str,
    fallback_ms: u64,
    min_ms: u64,
    max_ms: u64,
    log: F,
) -> u64
where
    F: FnMut(String),
{
    parse_clamped_timeout_env(raw, env_name, fallback_ms, min_ms, max_ms, log)
}

#[allow(clippy::too_many_arguments)]
pub fn resolve_backend_readiness_config<F>(
    ready_http_path_env: &str,
    default_ready_http_path: &str,
    ready_probe_timeout_env: &str,
    ready_probe_timeout_fallback_ms: u64,
    ready_probe_timeout_min_ms: u64,
    ready_probe_timeout_max_ms: u64,
    ready_poll_interval_env: &str,
    ready_poll_interval_fallback_ms: u64,
    ready_poll_interval_min_ms: u64,
    ready_poll_interval_max_ms: u64,
    mut log: F,
) -> (String, u64, u64)
where
    F: FnMut(String),
{
    let path =
        resolve_backend_ready_http_path(ready_http_path_env, default_ready_http_path, &mut log);

    let probe_timeout_ms = match env::var(ready_probe_timeout_env) {
        Ok(raw) => parse_clamped_timeout_env(
            &raw,
            ready_probe_timeout_env,
            ready_probe_timeout_fallback_ms,
            ready_probe_timeout_min_ms,
            ready_probe_timeout_max_ms,
            &mut log,
        ),
        Err(_) => ready_probe_timeout_fallback_ms,
    };

    let poll_interval_ms = match env::var(ready_poll_interval_env) {
        Ok(raw) => parse_clamped_timeout_env(
            &raw,
            ready_poll_interval_env,
            ready_poll_interval_fallback_ms,
            ready_poll_interval_min_ms,
            ready_poll_interval_max_ms,
            &mut log,
        ),
        Err(_) => ready_poll_interval_fallback_ms,
    };

    (path, probe_timeout_ms, poll_interval_ms)
}

pub fn resolve_backend_timeout_ms(
    packaged_mode: bool,
    timeout_env_name: &str,
    dev_default_timeout_ms: u64,
    packaged_timeout_fallback_ms: u64,
) -> Option<Duration> {
    let default_timeout_ms = if packaged_mode {
        0_u64
    } else {
        dev_default_timeout_ms
    };

    let parsed_timeout_ms = env::var(timeout_env_name)
        .ok()
        .and_then(|value| value.trim().parse::<u64>().ok())
        .unwrap_or(default_timeout_ms);

    if parsed_timeout_ms > 0 {
        return Some(Duration::from_millis(parsed_timeout_ms));
    }
    if packaged_mode {
        return Some(Duration::from_millis(packaged_timeout_fallback_ms));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_clamped_timeout_returns_value_in_range() {
        let value = parse_clamped_timeout_env("1200", "TEST_ENV", 500, 100, 5_000, |_| {});
        assert_eq!(value, 1200);
    }

    #[test]
    fn parse_clamped_timeout_clamps_too_small_value() {
        let mut logs = Vec::new();
        let value = parse_clamped_timeout_env("20", "TEST_ENV", 500, 100, 5_000, |message| {
            logs.push(message)
        });
        assert_eq!(value, 100);
        assert!(logs.iter().any(|line| line.contains("below minimum")));
    }

    #[test]
    fn parse_clamped_timeout_falls_back_on_invalid_value() {
        let mut logs = Vec::new();
        let value = parse_clamped_timeout_env("invalid", "TEST_ENV", 500, 100, 5_000, |message| {
            logs.push(message)
        });
        assert_eq!(value, 500);
        assert!(logs.iter().any(|line| line.contains("invalid TEST_ENV")));
    }

    #[test]
    fn parse_ping_timeout_delegates_to_clamp() {
        let value = parse_ping_timeout_env("99999", "TEST_ENV", 500, 100, 3_000, |_| {});
        assert_eq!(value, 3_000);
    }

    #[test]
    fn resolve_backend_timeout_uses_packaged_fallback_when_zero() {
        let timeout = resolve_backend_timeout_ms(true, "TEST_TIMEOUT_ENV_MISSING", 20_000, 300_000);
        assert_eq!(timeout, Some(Duration::from_millis(300_000)));
    }

    #[test]
    fn resolve_backend_timeout_is_none_for_dev_when_env_missing() {
        let timeout =
            resolve_backend_timeout_ms(false, "TEST_TIMEOUT_ENV_MISSING", 20_000, 300_000);
        assert_eq!(timeout, Some(Duration::from_millis(20_000)));
    }

    #[test]
    fn resolve_backend_timeout_is_none_for_dev_when_env_is_zero() {
        let env_name = "TEST_TIMEOUT_ENV_ZERO";
        env::set_var(env_name, "0");
        let timeout = resolve_backend_timeout_ms(false, env_name, 20_000, 300_000);
        env::remove_var(env_name);
        assert_eq!(timeout, None);
    }
}

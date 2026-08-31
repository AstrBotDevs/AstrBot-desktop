use std::{
    env, fs,
    path::Path,
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::{
    append_desktop_log, backend, AtomicFlagGuard, BackendState, BACKEND_TIMEOUT_ENV,
    PACKAGED_BACKEND_TIMEOUT_FALLBACK_MS,
};

const BACKEND_RESOURCE_VERSIONS_PATH: &str = "/api/v1/stats/versions";
const BACKEND_WEBUI_INDEX_PATH: &str = "/index.html";

#[derive(Debug, PartialEq, Eq)]
struct RunningResourceVersions {
    core: String,
    code: String,
    webui: String,
}

#[derive(Debug, PartialEq, Eq)]
enum RunningResourceIdentityError {
    Unavailable(String),
    Mismatch(String),
}

impl RunningResourceIdentityError {
    fn into_message(self) -> String {
        match self {
            Self::Unavailable(message) | Self::Mismatch(message) => message,
        }
    }
}

fn normalized_running_version(value: &serde_json::Value, field: &str) -> Result<String, String> {
    let raw = value
        .as_str()
        .ok_or_else(|| format!("running backend version field {field} is missing"))?;
    let trimmed = raw.trim();
    let normalized = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    if normalized.is_empty() {
        return Err(format!("running backend version field {field} is empty"));
    }
    Ok(normalized.to_string())
}

fn parse_running_resource_versions(
    payload: &serde_json::Value,
) -> Result<RunningResourceVersions, String> {
    if payload.get("status").and_then(serde_json::Value::as_str) != Some("ok") {
        return Err("running backend versions endpoint did not return status=ok".to_string());
    }
    let data = payload
        .get("data")
        .ok_or_else(|| "running backend versions response is missing data".to_string())?;
    Ok(RunningResourceVersions {
        core: normalized_running_version(&data["astrbot_version"], "astrbot_version")?,
        code: normalized_running_version(&data["astrbot_code_version"], "astrbot_code_version")?,
        webui: normalized_running_version(&data["webui_version"], "webui_version")?,
    })
}

fn validate_running_resource_versions(
    expected_core_version: &str,
    versions: &RunningResourceVersions,
) -> Result<(), String> {
    if versions.core == expected_core_version
        && versions.code == expected_core_version
        && versions.webui == expected_core_version
    {
        return Ok(());
    }
    Err(format!(
        "A different or stale AstrBot backend is already serving the Desktop port: expected Core/WebUI {}, got running Core {}, code {}, WebUI {}. Close the stale backend process, then restart AstrBot Desktop.",
        expected_core_version, versions.core, versions.code, versions.webui
    ))
}

fn validate_running_webui_index(
    expected_index_sha256: &str,
    running_index_sha256: &str,
) -> Result<(), String> {
    if running_index_sha256 == expected_index_sha256 {
        return Ok(());
    }
    Err(format!(
        "A different or stale AstrBot WebUI is already serving the Desktop port: expected index SHA-256 {expected_index_sha256}, got {running_index_sha256}. Close the stale backend process, then restart AstrBot Desktop."
    ))
}

fn validate_running_webui_entry(
    entry_path: &str,
    expected_sha256: &str,
    running_sha256: &str,
) -> Result<(), String> {
    if running_sha256 == expected_sha256 {
        return Ok(());
    }
    Err(format!(
        "A different, stale, or incomplete AstrBot WebUI is serving the Desktop port: entry {entry_path} expected SHA-256 {expected_sha256}, got {running_sha256}. Close the stale backend process, then restart AstrBot Desktop."
    ))
}

impl BackendState {
    pub(crate) fn ensure_backend_ready(&self, app: &AppHandle) -> Result<Option<String>, String> {
        let auto_start_enabled =
            env::var("ASTRBOT_BACKEND_AUTO_START").unwrap_or_else(|_| "1".to_string()) != "0";
        let ping_timeout_ms = backend::runtime::backend_ping_timeout_ms(append_desktop_log);
        if self.ping_backend(ping_timeout_ms) {
            if !auto_start_enabled {
                append_desktop_log(
                    "backend already reachable with auto-start disabled; using external backend without packaged resource identity enforcement",
                );
                return Ok(None);
            }
            append_desktop_log("backend already reachable, skip spawn");
            let plan = self.resolve_launch_plan(app)?;
            self.verify_running_resource_identity(&plan, ping_timeout_ms.max(1_000))?;
            return Ok(plan.webui_cache_version);
        }

        if !auto_start_enabled {
            append_desktop_log("backend auto-start disabled by ASTRBOT_BACKEND_AUTO_START=0");
            return Err(
                "Backend auto-start is disabled (ASTRBOT_BACKEND_AUTO_START=0).".to_string(),
            );
        }

        let _spawn_guard = AtomicFlagGuard::try_set(&self.is_spawning)
            .ok_or_else(|| "Backend action already in progress.".to_string())?;
        let plan = self.resolve_launch_plan(app)?;
        self.start_backend_process(app, &plan)?;
        self.wait_for_backend(&plan)?;
        Ok(plan.webui_cache_version)
    }

    pub(crate) fn wait_for_backend(&self, plan: &crate::LaunchPlan) -> Result<(), String> {
        let timeout_ms = backend::config::resolve_backend_timeout_ms(
            plan.packaged_mode,
            BACKEND_TIMEOUT_ENV,
            20_000,
            PACKAGED_BACKEND_TIMEOUT_FALLBACK_MS,
        );
        let readiness = backend::runtime::backend_readiness_config(plan, append_desktop_log);
        let startup_idle_timeout = Duration::from_millis(readiness.startup_idle_timeout_ms);
        let start_time = Instant::now();
        let mut tcp_ready_logged = false;
        let mut ever_tcp_reachable = false;
        let mut last_identity_unavailable = None;
        let mut startup_heartbeat_state = StartupHeartbeatTracker::new();

        loop {
            let (http_status, tcp_reachable) =
                self.probe_backend_readiness(&readiness.path, readiness.probe_timeout_ms);
            if matches!(http_status, Some(status_code) if (200..400).contains(&status_code)) {
                match self
                    .check_running_resource_identity(plan, readiness.probe_timeout_ms.max(1_000))
                {
                    Ok(()) => return Ok(()),
                    Err(RunningResourceIdentityError::Mismatch(message)) => return Err(message),
                    Err(RunningResourceIdentityError::Unavailable(message)) => {
                        if last_identity_unavailable.as_deref() != Some(message.as_str()) {
                            append_desktop_log(&format!(
                                "backend HTTP dashboard is ready but packaged resource identity is not readable yet; waiting: {message}"
                            ));
                        }
                        last_identity_unavailable = Some(message);
                    }
                }
            }
            let wall_now = SystemTime::now();
            let monotonic_now = Instant::now();

            let child_pid = self.live_child_pid()?;

            if let Some(heartbeat_path) = readiness.startup_heartbeat_path.as_deref() {
                step_startup_heartbeat(
                    heartbeat_path,
                    child_pid,
                    wall_now,
                    monotonic_now,
                    startup_idle_timeout,
                    &mut startup_heartbeat_state,
                )?;
            }

            if tcp_reachable {
                ever_tcp_reachable = true;
                if !tcp_ready_logged {
                    append_desktop_log(
                        "backend TCP port is reachable but HTTP dashboard is not ready yet; waiting",
                    );
                    tcp_ready_logged = true;
                }
            }

            if let Some(limit) = timeout_ms {
                if start_time.elapsed() >= limit {
                    self.log_backend_readiness_timeout(
                        limit,
                        &readiness,
                        wall_now,
                        http_status,
                        ever_tcp_reachable,
                        startup_heartbeat_state.last_seen_at,
                    );
                    let identity_detail = last_identity_unavailable
                        .as_deref()
                        .map(|message| format!(" Last identity check error: {message}"))
                        .unwrap_or_default();
                    return Err(format!(
                        "Timed out after {}ms waiting for backend startup.{}",
                        limit.as_millis(),
                        identity_detail
                    ));
                }
            }

            thread::sleep(Duration::from_millis(readiness.poll_interval_ms));
        }
    }

    pub(crate) fn verify_running_resource_identity(
        &self,
        plan: &crate::LaunchPlan,
        timeout_ms: u64,
    ) -> Result<(), String> {
        self.check_running_resource_identity(plan, timeout_ms)
            .map_err(RunningResourceIdentityError::into_message)
    }

    fn check_running_resource_identity(
        &self,
        plan: &crate::LaunchPlan,
        timeout_ms: u64,
    ) -> Result<(), RunningResourceIdentityError> {
        let Some(expected_core_version) = plan.packaged_core_version.as_deref() else {
            return Ok(());
        };
        let expected_index_sha256 = plan
            .packaged_webui_index_sha256
            .as_deref()
            .ok_or_else(|| {
                RunningResourceIdentityError::Mismatch(
                    "Packaged launch plan is missing the expected WebUI index digest. Run the Desktop update again or reinstall AstrBot."
                        .to_string(),
                )
            })?;
        let expected_entry_digests = plan
            .packaged_webui_entry_digests
            .as_deref()
            .filter(|entries| !entries.is_empty())
            .ok_or_else(|| {
                RunningResourceIdentityError::Mismatch(
                    "Packaged launch plan is missing the expected WebUI entry digests. Run the Desktop update again or reinstall AstrBot."
                        .to_string(),
                )
            })?;
        let payload = self
            .request_backend_json(
                "GET",
                BACKEND_RESOURCE_VERSIONS_PATH,
                timeout_ms,
                None,
                None,
            )
            .ok_or_else(|| {
                RunningResourceIdentityError::Unavailable(format!(
                    "Cannot verify the running AstrBot Core/WebUI identity at {BACKEND_RESOURCE_VERSIONS_PATH}. Close any stale backend process, then restart AstrBot Desktop."
                ))
            })?;
        let versions = parse_running_resource_versions(&payload)
            .map_err(RunningResourceIdentityError::Mismatch)?;
        validate_running_resource_versions(expected_core_version, &versions)
            .map_err(RunningResourceIdentityError::Mismatch)?;

        let index_body = self
            .request_backend_with(
                "GET",
                BACKEND_WEBUI_INDEX_PATH,
                timeout_ms,
                None,
                None,
                backend::http_response::parse_http_success_body,
            )
            .ok_or_else(|| {
                RunningResourceIdentityError::Unavailable(format!(
                    "Cannot read the running AstrBot WebUI entry document at {BACKEND_WEBUI_INDEX_PATH}."
                ))
            })?;
        let running_index_sha256 = format!("{:x}", Sha256::digest(&index_body));
        validate_running_webui_index(expected_index_sha256, &running_index_sha256)
            .map_err(RunningResourceIdentityError::Mismatch)?;

        for entry in expected_entry_digests {
            let request_path = format!("/{}", entry.path.trim_start_matches('/'));
            let response = self
                .request_backend_response_bytes("GET", &request_path, timeout_ms, None, None)
                .ok_or_else(|| {
                    RunningResourceIdentityError::Unavailable(format!(
                        "Cannot read the running AstrBot WebUI entry asset at {request_path}."
                    ))
                })?;
            let status_code = backend::http_response::parse_http_status_code(&response)
                .ok_or_else(|| {
                    RunningResourceIdentityError::Unavailable(format!(
                        "Cannot parse the running AstrBot WebUI entry response at {request_path}."
                    ))
                })?;
            if status_code == 404 {
                return Err(RunningResourceIdentityError::Mismatch(format!(
                    "The running AstrBot WebUI is incomplete: attested entry asset {request_path} is missing. Close the stale backend process, then restart AstrBot Desktop."
                )));
            }
            let entry_body = backend::http_response::parse_http_success_body(&response)
                .ok_or_else(|| {
                    RunningResourceIdentityError::Unavailable(format!(
                        "Cannot read a complete identity-encoded AstrBot WebUI entry response at {request_path} (HTTP {status_code})."
                    ))
                })?;
            let running_sha256 = format!("{:x}", Sha256::digest(&entry_body));
            validate_running_webui_entry(&request_path, &entry.sha256, &running_sha256)
                .map_err(RunningResourceIdentityError::Mismatch)?;
        }
        Ok(())
    }

    fn probe_backend_readiness(
        &self,
        ready_http_path: &str,
        probe_timeout_ms: u64,
    ) -> (Option<u16>, bool) {
        let http_status =
            self.request_backend_status_code("GET", ready_http_path, probe_timeout_ms, None, None);
        let tcp_timeout_ms = probe_timeout_ms.min(crate::BACKEND_READY_TCP_PROBE_TIMEOUT_MAX_MS);
        let tcp_reachable = self.ping_backend(tcp_timeout_ms);
        (http_status, tcp_reachable)
    }

    fn live_child_pid(&self) -> Result<u32, String> {
        let mut guard = self
            .child
            .lock()
            .map_err(|_| "Backend process lock poisoned.".to_string())?;

        if let Some(child) = guard.as_mut() {
            let pid = child.id();
            match child.try_wait() {
                Ok(Some(status)) => {
                    *guard = None;
                    Err(format!(
                        "Backend process exited before becoming reachable: {status}"
                    ))
                }
                Ok(None) => Ok(pid),
                Err(error) => Err(format!("Failed to poll backend process status: {error}")),
            }
        } else {
            Err("Backend process is not running.".to_string())
        }
    }

    fn log_backend_readiness_timeout(
        &self,
        timeout: Duration,
        readiness: &backend::config::BackendReadinessConfig,
        now: SystemTime,
        last_http_status: Option<u16>,
        tcp_reachable: bool,
        last_startup_heartbeat_at: Option<SystemTime>,
    ) {
        let last_http_status_text = last_http_status
            .map(|status| status.to_string())
            .unwrap_or_else(|| "none".to_string());
        let startup_heartbeat_age_ms = describe_heartbeat_age(last_startup_heartbeat_at, now);
        append_desktop_log(&format!(
            "backend HTTP readiness check timed out after {}ms: backend_url={}, path={}, probe_timeout_ms={}, tcp_reachable={}, last_http_status={}, startup_heartbeat_age_ms={}",
            timeout.as_millis(),
            self.backend_url,
            readiness.path,
            readiness.probe_timeout_ms,
            tcp_reachable,
            last_http_status_text,
            startup_heartbeat_age_ms
        ));
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct StartupHeartbeatFile {
    pid: u32,
    state: StartupHeartbeatState,
    updated_at_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum StartupHeartbeatState {
    Starting,
    Stopping,
}

#[derive(Debug, Clone, Copy)]
struct StartupHeartbeatTracker {
    last_seen_at: Option<SystemTime>,
    last_progress_at: Option<Instant>,
    consecutive_invalid_reads: u8,
    logged_fresh: bool,
}

impl StartupHeartbeatTracker {
    fn new() -> Self {
        Self {
            last_seen_at: None,
            last_progress_at: None,
            consecutive_invalid_reads: 0,
            logged_fresh: false,
        }
    }
}

const STARTUP_HEARTBEAT_INVALID_READ_THRESHOLD: u8 = 2;

fn read_startup_heartbeat_updated_at(path: &Path, expected_pid: u32) -> Option<SystemTime> {
    let payload = fs::read_to_string(path).ok()?;
    let heartbeat: StartupHeartbeatFile = serde_json::from_str(&payload).ok()?;
    if heartbeat.pid != expected_pid || heartbeat.state != StartupHeartbeatState::Starting {
        return None;
    }
    UNIX_EPOCH.checked_add(Duration::from_millis(heartbeat.updated_at_ms))
}

fn startup_heartbeat_progress_is_fresh(
    last_progress_at: Option<Instant>,
    now: Instant,
    max_age: Duration,
) -> bool {
    last_progress_at.is_some_and(|updated_at| now.duration_since(updated_at) <= max_age)
}

fn ms_since(earlier: SystemTime, now: SystemTime) -> Option<u128> {
    now.duration_since(earlier)
        .ok()
        .map(|duration| duration.as_millis())
}

fn describe_heartbeat_age(
    last_startup_heartbeat_at: Option<SystemTime>,
    now: SystemTime,
) -> String {
    match last_startup_heartbeat_at {
        Some(updated_at) => match ms_since(updated_at, now) {
            Some(age) => age.to_string(),
            None => format!("future ({updated_at:?})"),
        },
        None => "none".to_string(),
    }
}

fn step_startup_heartbeat(
    heartbeat_path: &Path,
    child_pid: u32,
    wall_now: SystemTime,
    monotonic_now: Instant,
    idle_timeout: Duration,
    state: &mut StartupHeartbeatTracker,
) -> Result<(), String> {
    let previous = state.last_seen_at;
    let current = read_startup_heartbeat_updated_at(heartbeat_path, child_pid);

    match (previous, current) {
        (Some(previous), None) => {
            state.consecutive_invalid_reads = state.consecutive_invalid_reads.saturating_add(1);
            if state.consecutive_invalid_reads < STARTUP_HEARTBEAT_INVALID_READ_THRESHOLD {
                return Ok(());
            }

            let heartbeat_age_ms = describe_heartbeat_age(Some(previous), wall_now);
            append_desktop_log(&format!(
                "backend startup heartbeat disappeared or became invalid before HTTP dashboard became ready: last_valid_age_ms={heartbeat_age_ms}"
            ));
            Err(
                "Backend startup heartbeat disappeared or became invalid before HTTP readiness."
                    .to_string(),
            )
        }
        (None, None) => {
            state.consecutive_invalid_reads = 0;
            Ok(())
        }
        (_, Some(current)) => {
            state.consecutive_invalid_reads = 0;
            let updated_at = match previous {
                Some(previous) if current <= previous => previous,
                _ => current,
            };
            state.last_seen_at = Some(updated_at);

            if previous.is_none()
                || Some(updated_at) != previous
                || state.last_progress_at.is_none()
            {
                state.last_progress_at = Some(monotonic_now);
            }

            if startup_heartbeat_progress_is_fresh(
                state.last_progress_at,
                monotonic_now,
                idle_timeout,
            ) {
                if !state.logged_fresh {
                    append_desktop_log(
                        "backend startup heartbeat is fresh while HTTP dashboard is not ready yet; waiting",
                    );
                    state.logged_fresh = true;
                }
                Ok(())
            } else {
                append_desktop_log(
                    "backend startup heartbeat went stale before HTTP dashboard became ready",
                );
                Err(format!(
                    "Backend startup heartbeat went stale after {}ms without HTTP readiness.",
                    idle_timeout.as_millis()
                ))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Read, Write},
        net::TcpListener,
        path::PathBuf,
        thread,
        time::{Duration, Instant, UNIX_EPOCH},
    };

    use tempfile::TempDir;

    use super::*;

    fn sha256_hex(payload: &[u8]) -> String {
        format!("{:x}", Sha256::digest(payload))
    }

    const WEBUI_ENTRY_PATH: &str = "/assets/index-test.js";

    fn packaged_plan(
        core_version: &str,
        index_sha256: &str,
        entry_sha256: &str,
    ) -> crate::LaunchPlan {
        crate::LaunchPlan {
            cmd: "python".to_string(),
            args: Vec::new(),
            cwd: PathBuf::from("."),
            root_dir: None,
            webui_dir: None,
            webui_cache_version: None,
            packaged_core_version: Some(core_version.to_string()),
            packaged_webui_index_sha256: Some(index_sha256.to_string()),
            packaged_webui_entry_digests: Some(vec![crate::app_types::RuntimeWebuiEntryDigest {
                path: WEBUI_ENTRY_PATH.trim_start_matches('/').to_string(),
                sha256: entry_sha256.to_string(),
            }]),
            startup_heartbeat_path: None,
            packaged_mode: true,
        }
    }

    fn spawn_identity_server(
        index_body: Vec<u8>,
        entry_response: Option<(u16, Vec<u8>)>,
    ) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind identity server");
        let address = listener.local_addr().expect("read identity server address");
        let versions_body = br#"{"status":"ok","data":{"astrbot_version":"4.27.5","astrbot_code_version":"4.27.5","webui_version":"4.27.5"}}"#.to_vec();
        let mut responses = vec![
            (
                BACKEND_RESOURCE_VERSIONS_PATH,
                "application/json",
                200,
                versions_body,
            ),
            (BACKEND_WEBUI_INDEX_PATH, "text/html", 200, index_body),
        ];
        if let Some((status_code, body)) = entry_response {
            responses.push((WEBUI_ENTRY_PATH, "text/javascript", status_code, body));
        }
        let handle = thread::spawn(move || {
            for (expected_path, content_type, status_code, body) in responses {
                let (mut stream, _) = listener.accept().expect("accept identity request");
                let mut request_bytes = [0_u8; 4096];
                let read = stream
                    .read(&mut request_bytes)
                    .expect("read identity request");
                let request = String::from_utf8_lossy(&request_bytes[..read]);
                assert!(
                    request.starts_with(&format!("GET {expected_path} HTTP/1.1\r\n")),
                    "unexpected request: {request}"
                );
                assert!(request.contains("Accept-Encoding: identity\r\n"));
                assert!(request.contains("Cache-Control: no-cache\r\n"));
                let reason = if status_code == 200 {
                    "OK"
                } else {
                    "Not Found"
                };
                let headers = format!(
                    "HTTP/1.1 {status_code} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                stream
                    .write_all(headers.as_bytes())
                    .expect("write identity headers");
                stream.write_all(&body).expect("write identity body");
            }
        });
        (format!("http://{address}/"), handle)
    }

    #[test]
    fn running_resource_versions_accept_matching_core_code_and_webui() {
        let payload = serde_json::json!({
            "status": "ok",
            "data": {
                "astrbot_version": "4.27.5",
                "astrbot_code_version": "4.27.5",
                "webui_version": "v4.27.5",
            },
        });

        let versions =
            parse_running_resource_versions(&payload).expect("parse matching running versions");

        assert_eq!(
            versions,
            RunningResourceVersions {
                core: "4.27.5".to_string(),
                code: "4.27.5".to_string(),
                webui: "4.27.5".to_string(),
            }
        );
        assert_eq!(
            validate_running_resource_versions("4.27.5", &versions),
            Ok(())
        );
    }

    #[test]
    fn running_resource_versions_reject_a_stale_backend_or_webui() {
        let versions = RunningResourceVersions {
            core: "4.27.0".to_string(),
            code: "4.27.5".to_string(),
            webui: "4.27.0".to_string(),
        };

        let error = validate_running_resource_versions("4.27.5", &versions)
            .expect_err("stale live resources must fail");

        assert!(error.contains("expected Core/WebUI 4.27.5"));
        assert!(error.contains("running Core 4.27.0, code 4.27.5, WebUI 4.27.0"));
        assert!(error.contains("Close the stale backend process"));
    }

    #[test]
    fn running_resource_versions_require_all_public_version_fields() {
        let payload = serde_json::json!({
            "status": "ok",
            "data": {
                "astrbot_version": "4.27.5",
                "webui_version": "v4.27.5",
            },
        });

        let error = parse_running_resource_versions(&payload)
            .expect_err("missing code version must fail closed");

        assert!(error.contains("astrbot_code_version is missing"));
    }

    #[test]
    fn running_webui_index_requires_an_exact_content_digest() {
        let expected = sha256_hex(b"new index");
        let stale = sha256_hex(b"old index");

        assert_eq!(validate_running_webui_index(&expected, &expected), Ok(()));
        let error = validate_running_webui_index(&expected, &stale)
            .expect_err("same-version stale WebUI content must fail");
        assert!(error.contains(&expected));
        assert!(error.contains(&stale));
        assert!(error.contains("Close the stale backend process"));
    }

    #[test]
    fn live_identity_check_accepts_the_exact_served_index_document() {
        let index_body = b"<!doctype html><title>current</title>".to_vec();
        let entry_body = b"console.log('current');".to_vec();
        let expected_index_digest = sha256_hex(&index_body);
        let expected_entry_digest = sha256_hex(&entry_body);
        let (backend_url, server) = spawn_identity_server(index_body, Some((200, entry_body)));
        let state = BackendState {
            backend_url,
            ..BackendState::default()
        };

        assert_eq!(
            state.verify_running_resource_identity(
                &packaged_plan("4.27.5", &expected_index_digest, &expected_entry_digest,),
                1_000,
            ),
            Ok(())
        );
        server.join().expect("identity server should finish");
    }

    #[test]
    fn live_identity_check_rejects_same_version_stale_index_content() {
        let stale_index = b"<!doctype html><title>stale</title>".to_vec();
        let expected_digest = sha256_hex(b"<!doctype html><title>current</title>");
        let expected_entry_digest = sha256_hex(b"console.log('current');");
        let (backend_url, server) = spawn_identity_server(stale_index, None);
        let state = BackendState {
            backend_url,
            ..BackendState::default()
        };

        let error = state
            .verify_running_resource_identity(
                &packaged_plan("4.27.5", &expected_digest, &expected_entry_digest),
                1_000,
            )
            .expect_err("same-version stale index must be rejected");
        assert!(error.contains("stale AstrBot WebUI"));
        server.join().expect("identity server should finish");
    }

    #[test]
    fn live_identity_check_rejects_same_version_stale_entry_content() {
        let index_body = b"<!doctype html><script src='/assets/index-test.js'></script>".to_vec();
        let expected_index_digest = sha256_hex(&index_body);
        let expected_entry_digest = sha256_hex(b"console.log('current');");
        let (backend_url, server) =
            spawn_identity_server(index_body, Some((200, b"console.log('stale');".to_vec())));
        let state = BackendState {
            backend_url,
            ..BackendState::default()
        };

        let error = state
            .verify_running_resource_identity(
                &packaged_plan("4.27.5", &expected_index_digest, &expected_entry_digest),
                1_000,
            )
            .expect_err("same-version stale entry must be rejected");
        assert!(error.contains(WEBUI_ENTRY_PATH));
        assert!(error.contains("expected SHA-256"));
        server.join().expect("identity server should finish");
    }

    #[test]
    fn live_identity_check_rejects_missing_attested_entry() {
        let index_body = b"<!doctype html><script src='/assets/index-test.js'></script>".to_vec();
        let expected_index_digest = sha256_hex(&index_body);
        let expected_entry_digest = sha256_hex(b"console.log('current');");
        let (backend_url, server) =
            spawn_identity_server(index_body, Some((404, b"missing".to_vec())));
        let state = BackendState {
            backend_url,
            ..BackendState::default()
        };

        let error = state
            .verify_running_resource_identity(
                &packaged_plan("4.27.5", &expected_index_digest, &expected_entry_digest),
                1_000,
            )
            .expect_err("missing attested entry must be rejected");
        assert!(error.contains("is incomplete"));
        assert!(error.contains(WEBUI_ENTRY_PATH));
        server.join().expect("identity server should finish");
    }

    #[test]
    fn startup_heartbeat_progress_is_fresh_for_recent_instant() {
        assert!(startup_heartbeat_progress_is_fresh(
            Some(Instant::now()),
            Instant::now() + Duration::from_millis(500),
            Duration::from_secs(1),
        ));
    }

    #[test]
    fn startup_heartbeat_progress_is_not_fresh_when_stale() {
        assert!(!startup_heartbeat_progress_is_fresh(
            Some(Instant::now()),
            Instant::now() + Duration::from_millis(1500),
            Duration::from_secs(1),
        ));
    }

    #[test]
    fn startup_heartbeat_is_not_fresh_for_mismatched_pid() {
        let temp_dir = TempDir::new().expect("create temp dir");
        let heartbeat_path = temp_dir.path().join("startup-heartbeat.json");
        std::fs::write(
            &heartbeat_path,
            r#"{"pid":7,"state":"starting","updated_at_ms":5000}"#,
        )
        .expect("write heartbeat file");

        assert_eq!(read_startup_heartbeat_updated_at(&heartbeat_path, 42), None);
    }

    #[test]
    fn step_startup_heartbeat_fails_when_existing_heartbeat_disappears() {
        let temp_dir = TempDir::new().expect("create temp dir");
        let heartbeat_path = temp_dir.path().join("missing-startup-heartbeat.json");
        let monotonic_now = Instant::now();
        let mut tracker = StartupHeartbeatTracker {
            last_seen_at: Some(UNIX_EPOCH + Duration::from_millis(5000)),
            last_progress_at: Some(monotonic_now),
            consecutive_invalid_reads: 0,
            logged_fresh: false,
        };

        let first_result = step_startup_heartbeat(
            &heartbeat_path,
            42,
            UNIX_EPOCH + Duration::from_millis(5500),
            monotonic_now,
            Duration::from_secs(1),
            &mut tracker,
        );

        let result = step_startup_heartbeat(
            &heartbeat_path,
            42,
            UNIX_EPOCH + Duration::from_millis(5600),
            monotonic_now + Duration::from_millis(100),
            Duration::from_secs(1),
            &mut tracker,
        );

        assert_eq!(first_result, Ok(()));
        assert_eq!(
            result,
            Err(
                "Backend startup heartbeat disappeared or became invalid before HTTP readiness."
                    .to_string()
            )
        );
    }

    #[test]
    fn step_startup_heartbeat_tolerates_single_missing_read_after_valid_heartbeat() {
        let temp_dir = TempDir::new().expect("create temp dir");
        let heartbeat_path = temp_dir.path().join("missing-startup-heartbeat.json");
        let monotonic_now = Instant::now();
        let mut tracker = StartupHeartbeatTracker {
            last_seen_at: Some(UNIX_EPOCH + Duration::from_millis(5000)),
            last_progress_at: Some(monotonic_now),
            consecutive_invalid_reads: 0,
            logged_fresh: false,
        };

        let result = step_startup_heartbeat(
            &heartbeat_path,
            42,
            UNIX_EPOCH + Duration::from_millis(5500),
            monotonic_now,
            Duration::from_secs(1),
            &mut tracker,
        );

        assert_eq!(result, Ok(()));
        assert_eq!(tracker.consecutive_invalid_reads, 1);
    }

    #[test]
    fn startup_heartbeat_file_rejects_unknown_state() {
        assert!(serde_json::from_str::<StartupHeartbeatFile>(
            r#"{"pid":42,"state":"unexpected","updated_at_ms":5000}"#
        )
        .is_err());
    }

    #[test]
    fn startup_heartbeat_file_rejects_unknown_fields() {
        assert!(serde_json::from_str::<StartupHeartbeatFile>(
            r#"{"pid":42,"state":"starting","updated_at_ms":5000,"unexpected":true}"#
        )
        .is_err());
    }

    #[test]
    fn read_startup_heartbeat_updated_at_handles_large_timestamp_without_panic() {
        let temp_dir = TempDir::new().expect("create temp dir");
        let heartbeat_path = temp_dir.path().join("startup-heartbeat.json");
        std::fs::write(
            &heartbeat_path,
            format!(
                r#"{{"pid":42,"state":"starting","updated_at_ms":{}}}"#,
                u64::MAX
            ),
        )
        .expect("write heartbeat file");

        assert_eq!(
            read_startup_heartbeat_updated_at(&heartbeat_path, 42),
            UNIX_EPOCH.checked_add(Duration::from_millis(u64::MAX))
        );
    }

    #[test]
    fn describe_heartbeat_age_distinguishes_future_timestamp_from_missing() {
        assert_eq!(
            describe_heartbeat_age(
                Some(UNIX_EPOCH + Duration::from_millis(6_000)),
                UNIX_EPOCH + Duration::from_millis(5_500)
            ),
            format!("future ({:?})", UNIX_EPOCH + Duration::from_millis(6_000))
        );
        assert_eq!(
            describe_heartbeat_age(None, UNIX_EPOCH + Duration::from_millis(5_500)),
            "none"
        );
    }
}

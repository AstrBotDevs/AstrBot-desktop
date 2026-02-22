use std::{
    env,
    fs::{self, OpenOptions},
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::AppHandle;

use crate::{
    append_desktop_log, backend_config, backend_path_override, backend_runtime,
    build_debug_command, launch_plan, logging, runtime_paths, AtomicFlagGuard, BackendState,
    BACKEND_LOG_MAX_BYTES, BACKEND_TIMEOUT_ENV, DEFAULT_SHELL_LOCALE, LOG_BACKUP_COUNT,
    PACKAGED_BACKEND_TIMEOUT_FALLBACK_MS,
};
#[cfg(target_os = "windows")]
use crate::{CREATE_NEW_PROCESS_GROUP, CREATE_NO_WINDOW};

impl BackendState {
    pub(crate) fn ensure_backend_ready(&self, app: &AppHandle) -> Result<(), String> {
        if self.ping_backend(backend_runtime::backend_ping_timeout_ms(append_desktop_log)) {
            append_desktop_log("backend already reachable, skip spawn");
            return Ok(());
        }

        if env::var("ASTRBOT_BACKEND_AUTO_START").unwrap_or_else(|_| "1".to_string()) == "0" {
            append_desktop_log("backend auto-start disabled by ASTRBOT_BACKEND_AUTO_START=0");
            return Err(
                "Backend auto-start is disabled (ASTRBOT_BACKEND_AUTO_START=0).".to_string(),
            );
        }

        let _spawn_guard = AtomicFlagGuard::try_set(&self.is_spawning)
            .ok_or_else(|| "Backend action already in progress.".to_string())?;
        let plan = self.resolve_launch_plan(app)?;
        self.start_backend_process(app, &plan)?;
        self.wait_for_backend(&plan)
    }

    pub(crate) fn resolve_launch_plan(&self, app: &AppHandle) -> Result<crate::LaunchPlan, String> {
        if let Some(custom_cmd) = env::var("ASTRBOT_BACKEND_CMD")
            .ok()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
        {
            return launch_plan::resolve_custom_launch(custom_cmd);
        }

        if let Some(plan) =
            launch_plan::resolve_packaged_launch(app, DEFAULT_SHELL_LOCALE, append_desktop_log)?
        {
            return Ok(plan);
        }

        launch_plan::resolve_dev_launch()
    }

    pub(crate) fn start_backend_process(
        &self,
        app: &AppHandle,
        plan: &crate::LaunchPlan,
    ) -> Result<(), String> {
        if self
            .child
            .lock()
            .map_err(|_| "Backend process lock poisoned.")?
            .is_some()
        {
            append_desktop_log("backend child already exists, skip re-spawn");
            return Ok(());
        }

        if !plan.cwd.exists() {
            fs::create_dir_all(&plan.cwd).map_err(|error| {
                format!(
                    "Failed to create backend cwd {}: {}",
                    plan.cwd.display(),
                    error
                )
            })?;
        }
        if let Some(root_dir) = &plan.root_dir {
            if !root_dir.exists() {
                fs::create_dir_all(root_dir).map_err(|error| {
                    format!(
                        "Failed to create backend root directory {}: {}",
                        root_dir.display(),
                        error
                    )
                })?;
            }
        }

        let mut command = Command::new(&plan.cmd);
        command
            .args(&plan.args)
            .current_dir(&plan.cwd)
            .stdin(Stdio::null())
            .env("PYTHONUNBUFFERED", "1")
            .env(
                "PYTHONUTF8",
                env::var("PYTHONUTF8").unwrap_or_else(|_| "1".to_string()),
            )
            .env(
                "PYTHONIOENCODING",
                env::var("PYTHONIOENCODING").unwrap_or_else(|_| "utf-8".to_string()),
            );
        if let Some(path_override) = backend_path_override() {
            command.env("PATH", path_override);
        }
        #[cfg(target_os = "windows")]
        {
            // Keep packaged backend fully backgrounded; keep console visible for local/dev debugging.
            if plan.packaged_mode {
                command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
            }
        }

        if plan.packaged_mode {
            command.env("ASTRBOT_DESKTOP_CLIENT", "1");
            if env::var("DASHBOARD_HOST").is_err() && env::var("ASTRBOT_DASHBOARD_HOST").is_err() {
                command.env("DASHBOARD_HOST", "127.0.0.1");
            }
            if env::var("DASHBOARD_PORT").is_err() && env::var("ASTRBOT_DASHBOARD_PORT").is_err() {
                command.env("DASHBOARD_PORT", "6185");
            }
        }

        if let Some(root_dir) = &plan.root_dir {
            command.env("ASTRBOT_ROOT", root_dir);
        }
        if let Some(webui_dir) = &plan.webui_dir {
            command.env("ASTRBOT_WEBUI_DIR", webui_dir);
        }

        let backend_log_path = Some(logging::resolve_backend_log_path(
            plan.root_dir.as_deref(),
            runtime_paths::default_packaged_root_dir(),
        ));
        if let Some(log_path) = backend_log_path.as_ref() {
            if let Some(log_parent) = log_path.parent() {
                fs::create_dir_all(log_parent).map_err(|error| {
                    format!(
                        "Failed to create backend log directory {}: {}",
                        log_parent.display(),
                        error
                    )
                })?;
            }
            logging::rotate_log_if_needed(
                log_path,
                BACKEND_LOG_MAX_BYTES,
                LOG_BACKUP_COUNT,
                "backend",
                false,
            );
            let stdout_file = OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)
                .map_err(|error| {
                    format!(
                        "Failed to open backend log {}: {}",
                        log_path.display(),
                        error
                    )
                })?;
            let stderr_file = stdout_file
                .try_clone()
                .map_err(|error| format!("Failed to clone backend log handle: {error}"))?;
            command.stdout(Stdio::from(stdout_file));
            command.stderr(Stdio::from(stderr_file));
        } else {
            self.stop_backend_log_rotation_worker();
            command.stdout(Stdio::null());
            command.stderr(Stdio::null());
        }

        let child = command.spawn().map_err(|error| {
            format!(
                "Failed to spawn backend process with command {:?}: {}",
                build_debug_command(plan),
                error
            )
        })?;
        let child_pid = child.id();
        append_desktop_log(&format!(
            "spawned backend: cmd={:?}, cwd={}",
            build_debug_command(plan),
            plan.cwd.display()
        ));
        *self
            .child
            .lock()
            .map_err(|_| "Backend process lock poisoned.")? = Some(child);
        if let Some(log_path) = backend_log_path {
            self.start_backend_log_rotation_worker(app, log_path, child_pid);
        } else {
            self.stop_backend_log_rotation_worker();
        }
        Ok(())
    }

    pub(crate) fn wait_for_backend(&self, plan: &crate::LaunchPlan) -> Result<(), String> {
        // This uses blocking polling intentionally and is called from spawn_blocking
        // startup/restart workers, not directly on the UI thread.
        let timeout_ms = backend_config::resolve_backend_timeout_ms(
            plan.packaged_mode,
            BACKEND_TIMEOUT_ENV,
            20_000,
            PACKAGED_BACKEND_TIMEOUT_FALLBACK_MS,
        );
        let readiness = backend_runtime::backend_readiness_config(append_desktop_log);
        let start_time = Instant::now();
        let mut tcp_ready_logged = false;
        let mut ever_tcp_reachable = false;

        loop {
            let (http_status, tcp_reachable) =
                self.probe_backend_readiness(&readiness.path, readiness.probe_timeout_ms);
            if matches!(http_status, Some(status_code) if (200..400).contains(&status_code)) {
                return Ok(());
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

            {
                let mut guard = self
                    .child
                    .lock()
                    .map_err(|_| "Backend process lock poisoned.".to_string())?;
                if let Some(child) = guard.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            *guard = None;
                            return Err(format!(
                                "Backend process exited before becoming reachable: {status}"
                            ));
                        }
                        Ok(None) => {}
                        Err(error) => {
                            return Err(format!("Failed to poll backend process status: {error}"));
                        }
                    }
                } else {
                    return Err("Backend process is not running.".to_string());
                }
            }

            if let Some(limit) = timeout_ms {
                if start_time.elapsed() >= limit {
                    self.log_backend_readiness_timeout(
                        limit,
                        &readiness.path,
                        readiness.probe_timeout_ms,
                        http_status,
                        ever_tcp_reachable,
                    );
                    return Err(format!(
                        "Timed out after {}ms waiting for backend startup.",
                        limit.as_millis()
                    ));
                }
            }

            thread::sleep(Duration::from_millis(readiness.poll_interval_ms));
        }
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

    fn log_backend_readiness_timeout(
        &self,
        timeout: Duration,
        ready_http_path: &str,
        probe_timeout_ms: u64,
        last_http_status: Option<u16>,
        tcp_reachable: bool,
    ) {
        let last_http_status_text = last_http_status
            .map(|status| status.to_string())
            .unwrap_or_else(|| "none".to_string());
        append_desktop_log(&format!(
            "backend HTTP readiness check timed out after {}ms: backend_url={}, path={}, probe_timeout_ms={}, tcp_reachable={}, last_http_status={}",
            timeout.as_millis(),
            self.backend_url,
            ready_http_path,
            probe_timeout_ms,
            tcp_reachable,
            last_http_status_text
        ));
    }
}

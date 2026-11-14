use std::{
    sync::atomic::Ordering,
    thread,
    time::{Duration, Instant},
};

use tauri::AppHandle;

use crate::{
    append_desktop_log, append_restart_log, backend, process_control, AtomicFlagGuard,
    BackendBridgeState, BackendState, LaunchPlan, BACKEND_EXIT_CONFIRM_POLL_INTERVAL_MS,
    BACKEND_EXIT_CONFIRM_TIMEOUT_MS, GRACEFUL_RESTART_POLL_INTERVAL_MS,
    GRACEFUL_RESTART_REQUEST_TIMEOUT_MS,
};

/// Gate a respawn on observable facts instead of the previous `Child` handle.
///
/// Two independent checks run before any spawn, in this order:
/// 1. the recorded process identity is no longer present, allowing a reused PID only
///    when its creation timestamp proves that it is a different process;
/// 2. the backend endpoint explicitly refuses connections on every resolved address.
///
/// The endpoint probe is a closure so it is evaluated only after the PID gate passes.
/// Sampling it up front would judge the port while the old backend is still shutting
/// down, and a backend that leaves during the wait would be reported as a conflict.
///
/// Both failures return an error instead of force-killing the PID. After a multi-second
/// pause the PID may already belong to an unrelated process, and terminating an unknown
/// process is worse than telling the user to stop the old backend manually.
fn preflight_before_respawn<P, E>(
    stopped_pid: u32,
    identity: Option<process_control::ProcessIdentity>,
    timeout: Duration,
    poll_interval: Duration,
    probe: P,
    endpoint_probe: E,
) -> Result<(), String>
where
    P: Fn(u32) -> process_control::ProcessProbe,
    E: FnOnce() -> Result<(), String>,
{
    // A first managed start has no stopped PID. An uncertain unmanaged restart
    // must be rejected by its strategy before it can reach this endpoint-only gate.
    if stopped_pid != 0 {
        let identity = identity.unwrap_or(process_control::ProcessIdentity {
            pid: stopped_pid,
            created_at: None,
        });
        let outcome = process_control::wait_for_process_identity_exit_with(
            identity,
            timeout,
            poll_interval,
            probe,
        );
        if outcome == process_control::ProcessExitOutcome::StillRunning {
            return Err(format!(
                "Previous backend exit could not be confirmed: pid={stopped_pid} still exists or cannot be inspected after {}ms. Wait and retry. Stop it manually only after verifying it is the backend.",
                timeout.as_millis()
            ));
        }
    }

    endpoint_probe()
}

impl BackendState {
    fn sanitize_auth_token(auth_token: Option<&str>) -> Option<String> {
        let token = auth_token?;
        if token.contains('\r') || token.contains('\n') {
            return None;
        }
        let token = token.trim();
        if token.is_empty() {
            return None;
        }
        Some(token.to_string())
    }

    fn get_restart_auth_token(&self) -> Option<String> {
        match self.restart_auth_token.lock() {
            Ok(guard) => guard.clone(),
            Err(error) => {
                append_restart_log(&format!(
                    "restart auth token lock poisoned when reading: {error}"
                ));
                None
            }
        }
    }

    pub(crate) fn set_restart_auth_token(&self, provided_auth_token: Option<&str>) {
        let normalized = Self::sanitize_auth_token(provided_auth_token);
        match self.restart_auth_token.lock() {
            Ok(mut guard) => {
                *guard = normalized;
            }
            Err(error) => append_restart_log(&format!(
                "restart auth token lock poisoned when writing: {error}"
            )),
        }
    }

    fn request_graceful_restart(&self, auth_token: Option<&str>) -> bool {
        let status_code = self.request_backend_status_code(
            "POST",
            "/api/stat/restart-core",
            GRACEFUL_RESTART_REQUEST_TIMEOUT_MS,
            Some("{}"),
            auth_token,
        );
        match status_code {
            Some(code) if (200..300).contains(&code) => true,
            Some(code) => {
                append_restart_log(&format!(
                    "graceful restart request rejected with HTTP status {code}"
                ));
                false
            }
            None => {
                append_restart_log(
                    "graceful restart request returned no HTTP status; will verify restart by polling backend",
                );
                true
            }
        }
    }

    fn wait_for_graceful_restart(
        &self,
        previous_start_time: Option<i64>,
        packaged_mode: bool,
    ) -> Result<(), String> {
        let max_wait = backend::runtime::backend_wait_timeout(packaged_mode);
        let start = Instant::now();
        let mut saw_backend_down = false;

        loop {
            let reachable = self.ping_backend(700);
            if !reachable {
                saw_backend_down = true;
            } else {
                let current_start_time = self.fetch_backend_start_time();
                if let (Some(previous), Some(current)) = (previous_start_time, current_start_time) {
                    if current != previous {
                        return Ok(());
                    }
                } else if previous_start_time.is_none() && saw_backend_down {
                    return Ok(());
                }
            }

            if start.elapsed() >= max_wait {
                return Err(format!(
                    "Timed out after {}ms waiting for graceful restart.",
                    max_wait.as_millis()
                ));
            }

            thread::sleep(Duration::from_millis(GRACEFUL_RESTART_POLL_INTERVAL_MS));
        }
    }

    pub(crate) fn stop_backend_for_bridge(&self) -> Result<(), String> {
        let _spawn_guard = AtomicFlagGuard::try_set(&self.is_spawning)
            .ok_or_else(|| "Backend action already in progress.".to_string())?;
        if self.has_managed_backend()? {
            self.stop_backend()?;
            return self.confirm_previous_backend_exited();
        }

        self.confirm_backend_endpoint_available(backend::runtime::backend_ping_timeout_ms(
            append_desktop_log,
        ))
    }

    /// Keep desktop ownership after an exited child is reaped or a stop is retried.
    pub(crate) fn has_managed_backend(&self) -> Result<bool, String> {
        let has_child = self
            .child
            .lock()
            .map(|guard| guard.is_some())
            .map_err(|error| {
                let message =
                    format!("backend child lock poisoned while resolving managed state: {error}");
                append_desktop_log(&message);
                message
            })?;
        if has_child || self.restart_stop_pid.load(Ordering::Acquire) != 0 {
            return Ok(true);
        }

        // Reaping an exited child must not change who manages its replacement.
        self.last_spawned_identity
            .lock()
            .map(|guard| guard.is_some())
            .map_err(|error| {
                let message = format!(
                    "backend spawn identity lock poisoned while resolving managed state: {error}"
                );
                append_desktop_log(&message);
                message
            })
    }

    fn restart_strategy(
        &self,
        plan: &LaunchPlan,
        has_managed_backend: bool,
    ) -> backend::restart_strategy::RestartStrategy {
        backend::restart_strategy::compute_restart_strategy(
            cfg!(target_os = "windows"),
            plan.packaged_mode,
            has_managed_backend,
        )
    }

    fn try_graceful_restart_and_wait(
        &self,
        auth_token: Option<&str>,
        previous_start_time: Option<i64>,
        packaged_mode: bool,
    ) -> backend::restart_strategy::GracefulRestartOutcome {
        let request_accepted = self.request_graceful_restart(auth_token);
        let wait_result = if request_accepted {
            self.wait_for_graceful_restart(previous_start_time, packaged_mode)
        } else {
            Ok(())
        };
        backend::restart_strategy::map_graceful_restart_outcome(request_accepted, wait_result)
    }

    fn execute_graceful_restart_strategy(
        &self,
        strategy: backend::restart_strategy::RestartStrategy,
        outcome: backend::restart_strategy::GracefulRestartOutcome,
    ) -> Result<backend::restart_strategy::RestartAction, String> {
        use backend::restart_strategy::RestartAction;

        // Interpret the strategy and observed API outcome before any managed fallback.
        match (strategy, outcome) {
            (
                backend::restart_strategy::RestartStrategy::ManagedWithGracefulFallback,
                backend::restart_strategy::GracefulRestartOutcome::Completed,
            )
            | (
                backend::restart_strategy::RestartStrategy::UnmanagedWithGracefulProbe,
                backend::restart_strategy::GracefulRestartOutcome::Completed,
            ) => {
                append_restart_log("graceful restart completed via backend api");
                Ok(RestartAction::GracefulCompleted)
            }
            (backend::restart_strategy::RestartStrategy::ManagedSkipGraceful, _) => {
                append_restart_log(
                    "skip graceful restart for packaged windows managed backend; using managed restart",
                );
                self.stop_backend_for_restart_flow()?;
                Ok(RestartAction::LaunchManagedReplacement)
            }
            (
                backend::restart_strategy::RestartStrategy::ManagedWithGracefulFallback,
                backend::restart_strategy::GracefulRestartOutcome::WaitFailed(error),
            ) => {
                append_restart_log(&format!(
                    "graceful restart did not complete, fallback to managed restart: {error}"
                ));
                self.stop_backend_for_restart_flow()?;
                Ok(RestartAction::LaunchManagedReplacement)
            }
            (
                backend::restart_strategy::RestartStrategy::ManagedWithGracefulFallback,
                backend::restart_strategy::GracefulRestartOutcome::RequestRejected,
            ) => {
                append_restart_log(
                    "graceful restart request was rejected, fallback to managed restart",
                );
                self.stop_backend_for_restart_flow()?;
                Ok(RestartAction::LaunchManagedReplacement)
            }
            (
                backend::restart_strategy::RestartStrategy::UnmanagedWithGracefulProbe,
                backend::restart_strategy::GracefulRestartOutcome::WaitFailed(error),
            ) => {
                let error = format!(
                    "Graceful restart did not complete and backend is not desktop-managed; refusing to start a replacement because the old process may still be restarting: {error}"
                );
                append_restart_log(&error);
                Err(error)
            }
            (
                backend::restart_strategy::RestartStrategy::UnmanagedWithGracefulProbe,
                backend::restart_strategy::GracefulRestartOutcome::RequestRejected,
            ) => Err(
                "graceful restart request was rejected and backend is not desktop-managed."
                    .to_string(),
            ),
        }
    }

    fn stop_backend_for_restart_flow(&self) -> Result<(), String> {
        // Remember which PID to confirm before spawning. The tracked handle wins; when it
        // is already gone it was reaped after an earlier exit, and the PID recorded at
        // spawn time is the one that must still be proven gone.
        let pid = self
            .tracked_child_pid()
            .or_else(|| self.last_recorded_pid())
            .unwrap_or(0);
        self.restart_stop_pid.store(pid, Ordering::Release);
        self.stop_backend()
    }

    /// Refuse to spawn unless the old backend is provably gone.
    ///
    /// Runs both gates exactly once, in this order:
    /// 1) the recorded process identity is no longer present;
    /// 2) the backend endpoint explicitly refuses connections.
    ///
    /// An unknown process identity or endpoint result blocks the replacement. A missing
    /// creation timestamp can also conservatively block a reused PID, so a failed check
    /// preserves the target for a retry instead of asserting that the backend is alive.
    ///
    /// A failure returns an error instead of force-killing the PID: after a multi-second
    /// pause the PID may already belong to an unrelated process, and terminating an
    /// unknown process is worse than telling the user to stop the old backend manually.
    pub(crate) fn confirm_previous_backend_exited(&self) -> Result<(), String> {
        let stopped_pid = self.restart_stop_pid.load(Ordering::Acquire);
        let identity = self.spawned_identity_for(stopped_pid);
        let result = preflight_before_respawn(
            stopped_pid,
            identity,
            Duration::from_millis(BACKEND_EXIT_CONFIRM_TIMEOUT_MS),
            Duration::from_millis(BACKEND_EXIT_CONFIRM_POLL_INTERVAL_MS),
            process_control::probe_process,
            || {
                self.confirm_backend_endpoint_available(backend::runtime::backend_ping_timeout_ms(
                    append_desktop_log,
                ))
            },
        );
        if result.is_ok() {
            let _ = self.restart_stop_pid.compare_exchange(
                stopped_pid,
                0,
                Ordering::AcqRel,
                Ordering::Acquire,
            );
        }
        match &result {
            Ok(()) if stopped_pid != 0 => append_restart_log(&format!(
                "previous backend confirmed exited before respawn: pid={stopped_pid}"
            )),
            Ok(()) => {}
            Err(error) => append_restart_log(error),
        }
        result
    }

    fn launch_backend_after_restart(
        &self,
        app: &AppHandle,
        plan: &LaunchPlan,
    ) -> Result<(), String> {
        self.start_backend_process(app, plan)?;
        self.wait_for_backend(plan)
    }

    pub(crate) fn restart_backend(
        &self,
        app: &AppHandle,
        auth_token: Option<&str>,
    ) -> Result<(), String> {
        append_restart_log("backend restart requested");

        let _spawn_guard = AtomicFlagGuard::try_set(&self.is_spawning)
            .ok_or_else(|| "Backend action already in progress.".to_string())?;
        let _restart_guard = AtomicFlagGuard::try_set(&self.is_restarting)
            .ok_or_else(|| "Backend action already in progress.".to_string())?;
        let plan = self.resolve_launch_plan(app)?;
        let has_managed_backend = self.has_managed_backend()?;
        let strategy = self.restart_strategy(&plan, has_managed_backend);
        let normalized_param = Self::sanitize_auth_token(auth_token);
        if let Some(token) = normalized_param.as_deref() {
            self.set_restart_auth_token(Some(token));
        }
        let restart_auth_token = normalized_param.or_else(|| self.get_restart_auth_token());
        let previous_start_time = self.fetch_backend_start_time();
        let outcome = match strategy {
            backend::restart_strategy::RestartStrategy::ManagedSkipGraceful => {
                backend::restart_strategy::GracefulRestartOutcome::RequestRejected
            }
            _ => self.try_graceful_restart_and_wait(
                restart_auth_token.as_deref(),
                previous_start_time,
                plan.packaged_mode,
            ),
        };
        match self.execute_graceful_restart_strategy(strategy, outcome)? {
            backend::restart_strategy::RestartAction::GracefulCompleted => self
                .verify_running_resource_identity(
                    &plan,
                    backend::runtime::backend_ping_timeout_ms(append_desktop_log).max(1_000),
                ),
            backend::restart_strategy::RestartAction::LaunchManagedReplacement => {
                self.launch_backend_after_restart(app, &plan)
            }
        }
    }

    pub(crate) fn bridge_state(&self, app: &AppHandle) -> BackendBridgeState {
        let has_managed_child = self
            .child
            .lock()
            .map(|guard| guard.is_some())
            .unwrap_or_else(|error| {
                append_desktop_log(&format!(
                    "backend bridge: child process mutex poisoned in bridge_state: {error}"
                ));
                false
            });
        let can_manage = has_managed_child || self.resolve_launch_plan(app).is_ok();
        BackendBridgeState {
            running: self.ping_backend(backend::runtime::bridge_backend_ping_timeout_ms(
                append_desktop_log,
            )),
            spawning: self.is_spawning.load(Ordering::Relaxed),
            restarting: self.is_restarting.load(Ordering::Relaxed),
            can_manage,
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        net::TcpListener,
        process::{Command, Stdio},
        sync::{atomic::Ordering, Mutex},
    };

    use super::{preflight_before_respawn, BackendState};
    use crate::{
        backend::restart_strategy::RestartStrategy, process_control::ProcessIdentity,
        process_control::ProcessProbe,
    };

    #[test]
    fn managed_backend_classification_survives_a_reaped_child() {
        let mut child = Command::new(std::env::current_exe().expect("locate test executable"))
            .arg("--list")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn a short-lived child");
        let state = BackendState::default();
        state.record_spawned_identity(child.id());
        child.wait().expect("reap the child");

        assert!(state.child.lock().unwrap().is_none());
        assert_eq!(state.restart_stop_pid.load(Ordering::Acquire), 0);
        assert!(
            state.has_managed_backend().unwrap(),
            "reaping the child must not discard desktop ownership of its backend"
        );
    }

    #[test]
    fn managed_backend_classification_recognizes_a_pending_stop() {
        let state = BackendState::default();
        state.restart_stop_pid.store(14360, Ordering::Release);

        assert!(
            state.has_managed_backend().unwrap(),
            "a pending stop must retain desktop management even without a child handle"
        );
    }

    #[test]
    fn backend_without_a_managed_child_or_history_stays_unmanaged() {
        assert!(!BackendState::default().has_managed_backend().unwrap());
    }

    #[test]
    fn bridge_stop_retry_does_not_clear_a_live_pending_process() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind backend endpoint");
        let state = BackendState {
            backend_url: format!("http://{}/", listener.local_addr().unwrap()),
            ..BackendState::default()
        };
        drop(listener);
        let pid = std::process::id();
        state.record_spawned_identity(pid);
        state.restart_stop_pid.store(pid, Ordering::Release);

        let error = state
            .stop_backend_for_bridge()
            .expect_err("a refused endpoint does not prove the pending process exited");

        assert!(error.contains("could not be confirmed"), "{error}");
        assert_eq!(state.restart_stop_pid.load(Ordering::Acquire), pid);
        assert!(!state.is_spawning.load(Ordering::Acquire));
    }

    #[test]
    fn managed_restart_fallback_requests_a_replacement_after_stopping() {
        use crate::backend::restart_strategy::{GracefulRestartOutcome, RestartAction};

        for outcome in [
            GracefulRestartOutcome::WaitFailed("backend exited".to_string()),
            GracefulRestartOutcome::RequestRejected,
        ] {
            let state = BackendState::default();
            let result = state.execute_graceful_restart_strategy(
                RestartStrategy::ManagedWithGracefulFallback,
                outcome,
            );

            assert_eq!(result, Ok(RestartAction::LaunchManagedReplacement));
        }
    }

    #[test]
    fn completed_graceful_restart_does_not_request_a_replacement() {
        use crate::backend::restart_strategy::{GracefulRestartOutcome, RestartAction};

        for strategy in [
            RestartStrategy::ManagedWithGracefulFallback,
            RestartStrategy::UnmanagedWithGracefulProbe,
        ] {
            let state = BackendState::default();
            state.restart_stop_pid.store(14360, Ordering::Release);

            assert_eq!(
                state
                    .execute_graceful_restart_strategy(strategy, GracefulRestartOutcome::Completed),
                Ok(RestartAction::GracefulCompleted)
            );
            assert_eq!(state.restart_stop_pid.load(Ordering::Acquire), 14360);
        }
    }

    #[test]
    fn packaged_windows_restart_requests_a_replacement_after_stopping() {
        use crate::backend::restart_strategy::{GracefulRestartOutcome, RestartAction};

        let state = BackendState::default();
        assert_eq!(
            state.execute_graceful_restart_strategy(
                RestartStrategy::ManagedSkipGraceful,
                GracefulRestartOutcome::RequestRejected,
            ),
            Ok(RestartAction::LaunchManagedReplacement)
        );
    }

    #[test]
    fn unmanaged_restart_timeout_never_authorizes_managed_fallback() {
        let state = BackendState::default();
        // A timed-out unmanaged restart must be rejected without consulting the
        // endpoint: a transient refusal would not prove that its process exited.

        let result = state.execute_graceful_restart_strategy(
            RestartStrategy::UnmanagedWithGracefulProbe,
            crate::backend::restart_strategy::GracefulRestartOutcome::WaitFailed(
                "restart timed out between listeners".to_string(),
            ),
        );

        let error = result.expect_err("an untracked restart must not enter managed fallback");
        assert!(error.contains("not desktop-managed"), "{error}");
        assert!(
            error.contains("restart timed out between listeners"),
            "{error}"
        );
        assert_eq!(state.restart_stop_pid.load(Ordering::Acquire), 0);
        assert!(state.child.lock().unwrap().is_none());
    }

    #[test]
    fn unmanaged_restart_completion_and_rejection_do_not_touch_managed_state() {
        use crate::backend::restart_strategy::GracefulRestartOutcome;

        for outcome in [
            GracefulRestartOutcome::Completed,
            GracefulRestartOutcome::RequestRejected,
        ] {
            let state = BackendState::default();
            state.restart_stop_pid.store(14360, Ordering::Release);
            let completed = outcome == GracefulRestartOutcome::Completed;

            let result = state.execute_graceful_restart_strategy(
                RestartStrategy::UnmanagedWithGracefulProbe,
                outcome,
            );

            assert_eq!(result.is_ok(), completed);
            assert_eq!(state.restart_stop_pid.load(Ordering::Acquire), 14360);
            assert!(state.child.lock().unwrap().is_none());
        }
    }

    #[test]
    fn bridge_stop_rejects_an_action_already_in_progress() {
        let state = BackendState {
            backend_url: "invalid URL".to_string(),
            ..BackendState::default()
        };
        state.is_spawning.store(true, Ordering::Release);

        assert_eq!(
            state.stop_backend_for_bridge(),
            Err("Backend action already in progress.".to_string())
        );
        assert!(state.is_spawning.load(Ordering::Acquire));
    }

    #[test]
    fn bridge_stop_reports_an_answering_backend_after_dropping_a_stale_child() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind backend endpoint");
        let mut child = Command::new(std::env::current_exe().expect("locate test executable"))
            .arg("--list")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn a short-lived child");
        child.wait().expect("reap the child");
        let state = BackendState {
            child: Mutex::new(Some(child)),
            backend_url: format!("http://{}/", listener.local_addr().unwrap()),
            ..BackendState::default()
        };

        assert!(state.stop_backend_for_bridge().is_err());
        assert!(state.child.lock().unwrap().is_none());
        assert!(!state.is_spawning.load(Ordering::Acquire));
    }

    #[test]
    fn bridge_stop_rejects_an_inconclusive_endpoint_probe() {
        let state = BackendState {
            backend_url: "invalid URL".to_string(),
            ..BackendState::default()
        };

        let error = state
            .stop_backend_for_bridge()
            .expect_err("a failed probe must not report a successful stop");
        assert!(error.contains("Cannot confirm backend endpoint"));
        assert!(!state.is_spawning.load(Ordering::Acquire));
    }

    #[test]
    fn failed_endpoint_confirmation_retains_the_pid_for_a_retry() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind backend endpoint");
        let mut child = Command::new(std::env::current_exe().expect("locate test executable"))
            .arg("--list")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn a short-lived child");
        let pid = child.id();
        child.wait().expect("reap the child");
        let state = BackendState {
            backend_url: format!("http://{}/", listener.local_addr().unwrap()),
            ..BackendState::default()
        };
        state.restart_stop_pid.store(pid, Ordering::Release);

        assert!(state.confirm_previous_backend_exited().is_err());
        assert_eq!(state.restart_stop_pid.load(Ordering::Acquire), pid);
        drop(listener);
        assert_eq!(state.confirm_previous_backend_exited(), Ok(()));
        assert_eq!(state.restart_stop_pid.load(Ordering::Acquire), 0);
    }

    #[test]
    fn stopping_an_empty_child_slot_remembers_the_last_spawned_identity() {
        let state = BackendState::default();
        let pid = std::process::id();
        state.record_spawned_identity(pid);

        assert_eq!(state.stop_backend(), Ok(()));
        assert_eq!(state.restart_stop_pid.load(Ordering::Acquire), pid);
    }

    #[test]
    fn sanitize_auth_token_rejects_empty_and_newline_tokens() {
        assert_eq!(BackendState::sanitize_auth_token(None), None);
        assert_eq!(BackendState::sanitize_auth_token(Some("   ")), None);
        assert_eq!(BackendState::sanitize_auth_token(Some("abc\r\ndef")), None);
        assert_eq!(BackendState::sanitize_auth_token(Some("abc\ndef")), None);
    }

    #[test]
    fn sanitize_auth_token_trims_valid_token() {
        assert_eq!(
            BackendState::sanitize_auth_token(Some("  token-123  ")),
            Some("token-123".to_string())
        );
    }

    #[test]
    fn restart_strategy_delegates_to_strategy_module() {
        let plan = crate::LaunchPlan {
            cmd: "python".to_string(),
            args: vec![],
            cwd: std::path::PathBuf::from("."),
            root_dir: None,
            webui_dir: None,
            webui_cache_version: None,
            packaged_core_version: None,
            packaged_webui_index_sha256: None,
            packaged_webui_entry_digests: None,
            startup_heartbeat_path: None,
            packaged_mode: true,
        };
        let state = BackendState::default();

        // A managed child on Windows packaged mode skips the graceful restart path; the
        // graceful fallback only applies elsewhere. Keep the platform in the expectation so
        // the delegating wrapper is asserted against the same inputs the strategy module sees.
        let expected = if cfg!(target_os = "windows") {
            RestartStrategy::ManagedSkipGraceful
        } else {
            RestartStrategy::ManagedWithGracefulFallback
        };
        assert_eq!(state.restart_strategy(&plan, true), expected);
    }

    fn identity(pid: u32, created_at: Option<u64>) -> Option<ProcessIdentity> {
        Some(ProcessIdentity { pid, created_at })
    }

    #[test]
    fn preflight_blocks_the_spawn_while_the_old_pid_is_still_alive() {
        let result = preflight_before_respawn(
            14360,
            identity(14360, Some(100)),
            std::time::Duration::from_millis(50),
            std::time::Duration::from_millis(10),
            |_| ProcessProbe::Alive {
                created_at: Some(100),
            },
            || Ok(()),
        );

        let error = result.expect_err("a still-running backend must block the respawn");
        assert!(
            error.contains("could not be confirmed"),
            "unexpected error: {error}"
        );
        assert!(
            error.contains("Wait and retry"),
            "unexpected error: {error}"
        );
        assert!(error.contains("pid=14360"), "unexpected error: {error}");
        assert!(
            error.contains("Stop it manually"),
            "the error must tell the user what to do: {error}"
        );
    }

    #[test]
    fn preflight_allows_the_spawn_once_the_old_pid_is_gone() {
        let probes = Mutex::new(Vec::new());
        let result = preflight_before_respawn(
            14360,
            identity(14360, Some(100)),
            std::time::Duration::from_millis(1_000),
            std::time::Duration::from_millis(10),
            |pid| {
                probes.lock().expect("lock probes").push(pid);
                ProcessProbe::Missing
            },
            || Ok(()),
        );

        assert!(result.is_ok(), "unexpected error: {result:?}");
        assert_eq!(
            *probes.lock().expect("lock probes"),
            vec![14360],
            "a gone PID should be answered on the first probe"
        );
    }

    #[test]
    fn preflight_treats_a_recycled_pid_as_exited() {
        // The PID answers, but the creation stamp differs, so it is a different process.
        let result = preflight_before_respawn(
            14360,
            identity(14360, Some(100)),
            std::time::Duration::from_millis(80),
            std::time::Duration::from_millis(10),
            |_| ProcessProbe::Alive {
                created_at: Some(999),
            },
            || Ok(()),
        );

        assert!(result.is_ok(), "unexpected error: {result:?}");
    }

    #[test]
    fn preflight_reports_a_timeout_when_the_old_pid_never_leaves() {
        let start = std::time::Instant::now();
        let result = preflight_before_respawn(
            14360,
            identity(14360, Some(100)),
            std::time::Duration::from_millis(60),
            std::time::Duration::from_millis(10),
            |_| ProcessProbe::Alive {
                created_at: Some(100),
            },
            || Ok(()),
        );

        assert!(result.is_err());
        let elapsed = start.elapsed();
        assert!(
            elapsed >= std::time::Duration::from_millis(60),
            "the wait must honour the timeout before reporting failure"
        );
        assert!(
            elapsed < std::time::Duration::from_millis(310),
            "the wait must stay within the timeout plus scheduling tolerance: {elapsed:?}"
        );
    }

    #[test]
    fn preflight_blocks_the_spawn_when_the_endpoint_still_answers() {
        // The tracked PID exited, but something else still serves the backend URL.
        let result = preflight_before_respawn(
            14360,
            identity(14360, Some(100)),
            std::time::Duration::from_millis(50),
            std::time::Duration::from_millis(10),
            |_| ProcessProbe::Missing,
            || Err("endpoint occupied".to_string()),
        );

        let error = result.expect_err("an answering endpoint must block the respawn");
        assert_eq!(error, "endpoint occupied");
    }

    #[test]
    fn preflight_skips_the_endpoint_probe_when_the_pid_gate_fails() {
        // The PID failure must short-circuit before the (expensive) endpoint probe runs.
        let endpoint_called = std::cell::Cell::new(false);
        let result = preflight_before_respawn(
            14360,
            identity(14360, Some(100)),
            std::time::Duration::from_millis(20),
            std::time::Duration::from_millis(10),
            |_| ProcessProbe::Alive {
                created_at: Some(100),
            },
            || {
                endpoint_called.set(true);
                Ok(())
            },
        );

        assert!(result.is_err());
        assert!(
            !endpoint_called.get(),
            "the endpoint probe must not run once the PID gate already failed"
        );
    }

    #[test]
    fn preflight_for_a_first_managed_start_only_checks_the_endpoint() {
        let ok = preflight_before_respawn(
            0,
            None,
            std::time::Duration::from_millis(50),
            std::time::Duration::from_millis(10),
            |_| panic!("no PID means nothing to probe"),
            || Ok(()),
        );
        assert!(ok.is_ok());

        let blocked = preflight_before_respawn(
            0,
            None,
            std::time::Duration::from_millis(50),
            std::time::Duration::from_millis(10),
            |_| panic!("no PID means nothing to probe"),
            || Err("endpoint occupied".to_string()),
        );
        assert!(blocked.is_err());
    }

    #[test]
    fn preflight_preserves_an_inconclusive_endpoint_error() {
        let result = preflight_before_respawn(
            0,
            None,
            std::time::Duration::from_millis(50),
            std::time::Duration::from_millis(10),
            |_| panic!("there is no stopped PID to probe"),
            || Err("DNS resolution timed out; endpoint availability is unknown".to_string()),
        );
        assert_eq!(
            result,
            Err("DNS resolution timed out; endpoint availability is unknown".to_string())
        );
    }
}

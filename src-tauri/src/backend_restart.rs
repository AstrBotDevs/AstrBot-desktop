use std::{
    sync::atomic::Ordering,
    thread,
    time::{Duration, Instant},
};

use tauri::AppHandle;

use crate::{
    append_desktop_log, append_restart_log, backend_runtime, AtomicFlagGuard, BackendBridgeState,
    BackendState, LaunchPlan, GRACEFUL_RESTART_POLL_INTERVAL_MS,
    GRACEFUL_RESTART_REQUEST_TIMEOUT_MS,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RestartStrategy {
    ManagedSkipGraceful,
    ManagedWithGracefulFallback,
    UnmanagedWithGracefulProbe,
}

#[derive(Debug)]
enum GracefulRestartOutcome {
    Completed,
    WaitFailed(String),
    RequestRejected,
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
        let max_wait = backend_runtime::backend_wait_timeout(packaged_mode);
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
        let has_managed_child = self
            .child
            .lock()
            .map_err(|_| "Backend process lock poisoned.".to_string())?
            .is_some();
        if has_managed_child {
            return self.stop_backend();
        }

        if self.ping_backend(backend_runtime::backend_ping_timeout_ms(append_desktop_log)) {
            return Err("Backend is running but not managed by desktop process.".to_string());
        }
        Ok(())
    }

    fn has_managed_child(&self) -> Result<bool, String> {
        self.child
            .lock()
            .map(|guard| guard.is_some())
            .map_err(|error| {
                let message = format!(
                    "backend child lock poisoned while resolving restart strategy: {error}"
                );
                append_desktop_log(&message);
                message
            })
    }

    fn restart_strategy(&self, plan: &LaunchPlan, has_managed_child: bool) -> RestartStrategy {
        Self::compute_restart_strategy(
            cfg!(target_os = "windows"),
            plan.packaged_mode,
            has_managed_child,
        )
    }

    fn compute_restart_strategy(
        is_windows: bool,
        packaged_mode: bool,
        has_managed_child: bool,
    ) -> RestartStrategy {
        if is_windows && packaged_mode && has_managed_child {
            RestartStrategy::ManagedSkipGraceful
        } else if has_managed_child {
            RestartStrategy::ManagedWithGracefulFallback
        } else {
            RestartStrategy::UnmanagedWithGracefulProbe
        }
    }

    fn try_graceful_restart_and_wait(
        &self,
        auth_token: Option<&str>,
        previous_start_time: Option<i64>,
        packaged_mode: bool,
    ) -> GracefulRestartOutcome {
        if !self.request_graceful_restart(auth_token) {
            return GracefulRestartOutcome::RequestRejected;
        }

        match self.wait_for_graceful_restart(previous_start_time, packaged_mode) {
            Ok(()) => GracefulRestartOutcome::Completed,
            Err(error) => GracefulRestartOutcome::WaitFailed(error),
        }
    }

    pub(crate) fn restart_backend(
        &self,
        app: &AppHandle,
        auth_token: Option<&str>,
    ) -> Result<(), String> {
        append_restart_log("backend restart requested");

        let _restart_guard = AtomicFlagGuard::try_set(&self.is_restarting)
            .ok_or_else(|| "Backend action already in progress.".to_string())?;
        let plan = self.resolve_launch_plan(app)?;
        let has_managed_child = self.has_managed_child()?;
        let strategy = self.restart_strategy(&plan, has_managed_child);
        let normalized_param = Self::sanitize_auth_token(auth_token);
        if let Some(token) = normalized_param.as_deref() {
            self.set_restart_auth_token(Some(token));
        }
        let restart_auth_token = normalized_param.or_else(|| self.get_restart_auth_token());
        let previous_start_time = self.fetch_backend_start_time();
        match strategy {
            RestartStrategy::ManagedSkipGraceful => append_restart_log(
                "skip graceful restart for packaged windows managed backend; using managed restart",
            ),
            RestartStrategy::ManagedWithGracefulFallback => {
                match self.try_graceful_restart_and_wait(
                    restart_auth_token.as_deref(),
                    previous_start_time,
                    plan.packaged_mode,
                ) {
                    GracefulRestartOutcome::Completed => {
                        append_restart_log("graceful restart completed via backend api");
                        return Ok(());
                    }
                    GracefulRestartOutcome::WaitFailed(error) => append_restart_log(&format!(
                        "graceful restart did not complete, fallback to managed restart: {error}"
                    )),
                    GracefulRestartOutcome::RequestRejected => append_restart_log(
                        "graceful restart request was rejected, fallback to managed restart",
                    ),
                }
            }
            RestartStrategy::UnmanagedWithGracefulProbe => {
                match self.try_graceful_restart_and_wait(
                    restart_auth_token.as_deref(),
                    previous_start_time,
                    plan.packaged_mode,
                ) {
                    GracefulRestartOutcome::Completed => {
                        append_restart_log("graceful restart completed via backend api");
                        return Ok(());
                    }
                    GracefulRestartOutcome::WaitFailed(error) => append_restart_log(&format!(
                        "graceful restart did not complete for unmanaged backend, bootstrap managed restart: {error}"
                    )),
                    GracefulRestartOutcome::RequestRejected => {
                        return Err(
                            "graceful restart request was rejected and backend is not desktop-managed."
                                .to_string(),
                        );
                    }
                }
            }
        }

        self.stop_backend()?;
        let _spawn_guard = AtomicFlagGuard::set(&self.is_spawning);
        self.start_backend_process(app, &plan)?;
        self.wait_for_backend(&plan)
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
            running: self.ping_backend(backend_runtime::bridge_backend_ping_timeout_ms(
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
    use super::{BackendState, RestartStrategy};

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
    fn compute_restart_strategy_windows_packaged_managed_skips_graceful() {
        assert_eq!(
            BackendState::compute_restart_strategy(true, true, true),
            RestartStrategy::ManagedSkipGraceful
        );
    }

    #[test]
    fn compute_restart_strategy_managed_uses_graceful_fallback() {
        assert_eq!(
            BackendState::compute_restart_strategy(false, true, true),
            RestartStrategy::ManagedWithGracefulFallback
        );
    }

    #[test]
    fn compute_restart_strategy_unmanaged_uses_graceful_probe() {
        assert_eq!(
            BackendState::compute_restart_strategy(false, false, false),
            RestartStrategy::UnmanagedWithGracefulProbe
        );
    }
}

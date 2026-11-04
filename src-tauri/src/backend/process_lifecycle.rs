use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};

use tauri::{AppHandle, Manager};

use crate::{
    append_desktop_log, logging, process_control, BackendState,
    BACKEND_EXIT_CONFIRM_POLL_INTERVAL_MS, BACKEND_EXIT_CONFIRM_TIMEOUT_MS, BACKEND_LOG_MAX_BYTES,
    BACKEND_LOG_ROTATION_CHECK_INTERVAL, GRACEFUL_STOP_TIMEOUT_MS, LOG_BACKUP_COUNT,
};

/// Confirmation that the process captured by an identity has really left the OS.
///
/// `Child::try_wait` is not enough on its own: a handle whose process already died (or
/// whose PID was recycled) reaps immediately, so a stop that never touched the real
/// backend would still look successful. The probe below asks the OS about the PID, which
/// is the observable fact a restart is allowed to depend on.
fn confirm_process_identity_exit(identity: process_control::ProcessIdentity) -> Result<(), String> {
    let outcome = process_control::wait_for_process_identity_exit(
        identity,
        Duration::from_millis(BACKEND_EXIT_CONFIRM_TIMEOUT_MS),
        Duration::from_millis(BACKEND_EXIT_CONFIRM_POLL_INTERVAL_MS),
    );
    if outcome == process_control::ProcessExitOutcome::StillRunning {
        return Err(format!(
            "Backend process is still running after the stop request: pid={}, waited {}ms. Stop it manually before starting another backend.",
            identity.pid, BACKEND_EXIT_CONFIRM_TIMEOUT_MS
        ));
    }
    Ok(())
}

impl BackendState {
    pub(crate) fn stop_backend(&self) -> Result<(), String> {
        self.stop_backend_with_timeout(Duration::from_millis(GRACEFUL_STOP_TIMEOUT_MS))
    }

    pub(crate) fn stop_backend_with_timeout(&self, timeout: Duration) -> Result<(), String> {
        self.stop_backend_log_rotation_worker();
        let mut guard = self
            .child
            .lock()
            .map_err(|_| "Backend process lock poisoned.".to_string())?;

        let Some(child) = guard.as_mut() else {
            return Ok(());
        };

        // Capture the identity before stopping: it is the only thing that can later
        // separate "our backend exited" from "some other process answers on that PID".
        let identity = process_control::capture_process_identity(child.id());

        if process_control::stop_child_process_gracefully(child, timeout, append_desktop_log) {
            // Drop the reaped handle before confirming. Keeping it would leave a `Child`
            // whose `try_wait` reports `Some` forever; a retried stop would then taskkill
            // that stale PID even after the OS recycled it for an unrelated process.
            *guard = None;
            confirm_process_identity_exit(identity)?;
            return Ok(());
        }

        Err(format!(
            "Backend process did not exit after {}ms graceful stop timeout.",
            timeout.as_millis()
        ))
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn stop_backend_for_system_shutdown(&self, timeout: Duration) -> Result<(), String> {
        self.stop_backend_log_rotation_worker();
        let mut guard = self
            .child
            .lock()
            .map_err(|_| "Backend process lock poisoned.".to_string())?;

        let Some(child) = guard.as_mut() else {
            return Ok(());
        };

        // System shutdown is time critical, so unlike the restart flow it does not spend
        // extra time confirming the exit; the OS is about to terminate everything anyway.
        if process_control::stop_child_process_for_system_shutdown(
            child,
            timeout,
            append_desktop_log,
        ) {
            *guard = None;
            return Ok(());
        }

        Err(format!(
            "Backend process did not exit after {}ms Windows shutdown stop timeout.",
            timeout.as_millis()
        ))
    }

    /// Remember which process was just spawned, while it is certainly still alive.
    pub(crate) fn record_spawned_identity(&self, pid: u32) {
        let identity = process_control::capture_process_identity(pid);
        match self.last_spawned_identity.lock() {
            Ok(mut guard) => *guard = Some(identity),
            Err(error) => append_desktop_log(&format!(
                "backend last-spawned identity lock poisoned on spawn: pid={pid}, error={error}"
            )),
        }
    }

    /// Identity recorded for `pid`, used to detect PID recycling across a restart.
    pub(crate) fn spawned_identity_for(
        &self,
        pid: u32,
    ) -> Option<process_control::ProcessIdentity> {
        match self.last_spawned_identity.lock() {
            Ok(guard) => guard.filter(|identity| identity.pid == pid),
            Err(error) => {
                append_desktop_log(&format!(
                    "backend last-spawned identity lock poisoned when reading pid={pid}: {error}"
                ));
                None
            }
        }
    }

    /// PID of the child handle this shell still tracks, without polling it.
    pub(crate) fn tracked_child_pid(&self) -> Option<u32> {
        match self.child.lock() {
            Ok(guard) => guard.as_ref().map(std::process::Child::id),
            Err(error) => {
                append_desktop_log(&format!(
                    "backend child lock poisoned when reading tracked pid: {error}"
                ));
                None
            }
        }
    }

    /// PID the shell last spawned, kept even after the `Child` handle was dropped.
    ///
    /// This is what lets a restart name the backend that it must confirm gone when the
    /// handle was already reaped — the exact situation that used to hide a still-running
    /// backend behind a handle reporting `None`.
    pub(crate) fn last_recorded_pid(&self) -> Option<u32> {
        match self.last_spawned_identity.lock() {
            Ok(guard) => guard.map(|identity| identity.pid),
            Err(error) => {
                append_desktop_log(&format!(
                    "backend last-spawned identity lock poisoned when reading pid: {error}"
                ));
                None
            }
        }
    }

    pub(crate) fn stop_backend_log_rotation_worker(&self) {
        match self.log_rotator_stop.lock() {
            Ok(mut guard) => {
                if let Some(flag) = guard.take() {
                    flag.store(true, Ordering::Relaxed);
                }
            }
            Err(error) => {
                append_desktop_log(&format!(
                    "backend log rotator stop flag lock poisoned: {error}"
                ));
            }
        }
    }

    fn child_matches_pid_and_alive(&self, child_pid: u32) -> bool {
        let mut guard = match self.child.lock() {
            Ok(guard) => guard,
            Err(error) => {
                append_desktop_log(&format!(
                    "backend child lock poisoned while checking log rotator worker pid={child_pid}: {error}"
                ));
                return false;
            }
        };

        let poll = {
            let Some(child) = guard.as_mut() else {
                return false;
            };
            if child.id() != child_pid {
                return false;
            }
            child.try_wait()
        };

        match poll {
            Ok(None) => true,
            Ok(Some(status)) => {
                append_desktop_log(&format!(
                    "backend process exited, stop log rotator worker: pid={child_pid}, status={status}"
                ));
                // Drop the reaped handle right away. Keeping it would leave a `Child`
                // whose `try_wait` returns `Some` instantly, and the restart flow would
                // read that as "backend already stopped" while the PID may already have
                // been recycled by an unrelated process.
                *guard = None;
                false
            }
            Err(error) => {
                append_desktop_log(&format!(
                    "failed to poll backend process status for log rotator worker pid={child_pid}: {error}"
                ));
                false
            }
        }
    }

    pub(crate) fn start_backend_log_rotation_worker(
        &self,
        app: &AppHandle,
        log_path: PathBuf,
        child_pid: u32,
    ) {
        self.stop_backend_log_rotation_worker();
        let stop_flag = Arc::new(AtomicBool::new(false));
        match self.log_rotator_stop.lock() {
            Ok(mut guard) => {
                *guard = Some(stop_flag.clone());
            }
            Err(error) => {
                append_desktop_log(&format!(
                    "backend log rotator stop flag lock poisoned on start: {error}"
                ));
                return;
            }
        }

        let app_handle = app.clone();
        thread::spawn(move || {
            let log_scope = format!("backend(pid={child_pid})");
            loop {
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }
                thread::sleep(BACKEND_LOG_ROTATION_CHECK_INTERVAL);
                if stop_flag.load(Ordering::Relaxed) {
                    break;
                }
                let state = app_handle.state::<BackendState>();
                if !state.child_matches_pid_and_alive(child_pid) {
                    break;
                }
                logging::rotate_log_if_needed(
                    &log_path,
                    BACKEND_LOG_MAX_BYTES,
                    LOG_BACKUP_COUNT,
                    &log_scope,
                    true,
                );
            }
        });
    }
}

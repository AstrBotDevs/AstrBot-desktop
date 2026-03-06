#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RestartStrategy {
    ManagedSkipGraceful,
    ManagedWithGracefulFallback,
    UnmanagedWithGracefulProbe,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum GracefulRestartOutcome {
    Completed,
    WaitFailed(String),
    RequestRejected,
}

pub(crate) fn compute_restart_strategy(
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

pub(crate) fn map_graceful_restart_outcome(
    request_accepted: bool,
    wait_result: Result<(), String>,
) -> GracefulRestartOutcome {
    if !request_accepted {
        return GracefulRestartOutcome::RequestRejected;
    }

    match wait_result {
        Ok(()) => GracefulRestartOutcome::Completed,
        Err(error) => GracefulRestartOutcome::WaitFailed(error),
    }
}

#[cfg(test)]
mod tests {
    use super::{
        compute_restart_strategy, map_graceful_restart_outcome, GracefulRestartOutcome,
        RestartStrategy,
    };

    #[test]
    fn compute_restart_strategy_windows_packaged_managed_skips_graceful() {
        assert_eq!(
            compute_restart_strategy(true, true, true),
            RestartStrategy::ManagedSkipGraceful
        );
    }

    #[test]
    fn compute_restart_strategy_managed_uses_graceful_fallback() {
        assert_eq!(
            compute_restart_strategy(false, true, true),
            RestartStrategy::ManagedWithGracefulFallback
        );
    }

    #[test]
    fn compute_restart_strategy_unmanaged_uses_graceful_probe() {
        assert_eq!(
            compute_restart_strategy(false, false, false),
            RestartStrategy::UnmanagedWithGracefulProbe
        );
    }

    #[test]
    fn map_graceful_restart_outcome_returns_request_rejected_when_request_fails() {
        assert_eq!(
            map_graceful_restart_outcome(false, Ok(())),
            GracefulRestartOutcome::RequestRejected
        );
    }

    #[test]
    fn map_graceful_restart_outcome_returns_completed_when_wait_succeeds() {
        assert_eq!(
            map_graceful_restart_outcome(true, Ok(())),
            GracefulRestartOutcome::Completed
        );
    }

    #[test]
    fn map_graceful_restart_outcome_returns_wait_failed_when_wait_errors() {
        assert_eq!(
            map_graceful_restart_outcome(true, Err("timeout".to_string())),
            GracefulRestartOutcome::WaitFailed("timeout".to_string())
        );
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ExitLifecycleState {
    #[default]
    Running,
    QuittingRequested,
    CleanupInProgress,
    ReadyToExit,
    Exiting,
}

#[derive(Debug, Default)]
pub struct ExitStateMachine {
    state: ExitLifecycleState,
}

impl ExitStateMachine {
    #[cfg(test)]
    pub fn state(&self) -> ExitLifecycleState {
        self.state
    }

    pub fn is_quitting(&self) -> bool {
        self.state != ExitLifecycleState::Running
    }

    pub fn mark_quitting(&mut self) {
        if self.state == ExitLifecycleState::Running {
            self.state = ExitLifecycleState::QuittingRequested;
        }
    }

    pub fn try_begin_cleanup(&mut self) -> bool {
        if matches!(
            self.state,
            ExitLifecycleState::Running | ExitLifecycleState::QuittingRequested
        ) {
            self.state = ExitLifecycleState::CleanupInProgress;
            return true;
        }
        false
    }

    pub fn allow_next_exit_request(&mut self) {
        self.state = ExitLifecycleState::ReadyToExit;
    }

    pub fn take_exit_request_allowance(&mut self) -> bool {
        if self.state == ExitLifecycleState::ReadyToExit {
            self.state = ExitLifecycleState::Exiting;
            return true;
        }
        false
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_machine_flows_through_cleanup_to_exit() {
        let mut machine = ExitStateMachine::default();
        assert_eq!(machine.state(), ExitLifecycleState::Running);
        assert!(!machine.is_quitting());

        machine.mark_quitting();
        assert_eq!(machine.state(), ExitLifecycleState::QuittingRequested);
        assert!(machine.is_quitting());

        assert!(machine.try_begin_cleanup());
        assert_eq!(machine.state(), ExitLifecycleState::CleanupInProgress);
        assert!(machine.is_quitting());

        machine.allow_next_exit_request();
        assert_eq!(machine.state(), ExitLifecycleState::ReadyToExit);
        assert!(machine.take_exit_request_allowance());
        assert_eq!(machine.state(), ExitLifecycleState::Exiting);
    }

    #[test]
    fn state_machine_rejects_duplicate_cleanup() {
        let mut machine = ExitStateMachine::default();
        assert!(machine.try_begin_cleanup());
        assert!(!machine.try_begin_cleanup());
        assert_eq!(machine.state(), ExitLifecycleState::CleanupInProgress);
    }

    #[test]
    fn mark_quitting_does_not_override_cleanup_or_ready_states() {
        let mut machine = ExitStateMachine::default();
        assert!(machine.try_begin_cleanup());
        machine.mark_quitting();
        assert_eq!(machine.state(), ExitLifecycleState::CleanupInProgress);

        machine.allow_next_exit_request();
        machine.mark_quitting();
        assert_eq!(machine.state(), ExitLifecycleState::ReadyToExit);
    }
}

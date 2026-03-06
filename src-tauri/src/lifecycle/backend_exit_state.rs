use crate::{append_desktop_log, BackendState};

impl BackendState {
    pub(crate) fn mark_quitting(&self) {
        match self.exit_state.lock() {
            Ok(mut guard) => guard.mark_quitting(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when marking quitting: {error}"
                ));
                error.into_inner().mark_quitting();
            }
        }
    }

    pub(crate) fn is_quitting(&self) -> bool {
        match self.exit_state.lock() {
            Ok(guard) => guard.is_quitting(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when reading quitting state: {error}"
                ));
                error.into_inner().is_quitting()
            }
        }
    }

    pub(crate) fn try_begin_exit_cleanup(&self) -> bool {
        match self.exit_state.lock() {
            Ok(mut guard) => guard.try_begin_cleanup(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when beginning cleanup: {error}"
                ));
                error.into_inner().try_begin_cleanup()
            }
        }
    }

    pub(crate) fn allow_next_exit_request(&self) {
        match self.exit_state.lock() {
            Ok(mut guard) => guard.allow_next_exit_request(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when allowing next exit request: {error}"
                ));
                error.into_inner().allow_next_exit_request();
            }
        }
    }

    pub(crate) fn take_exit_request_allowance(&self) -> bool {
        match self.exit_state.lock() {
            Ok(mut guard) => guard.take_exit_request_allowance(),
            Err(error) => {
                append_desktop_log(&format!(
                    "exit state lock poisoned when taking exit request allowance: {error}"
                ));
                error.into_inner().take_exit_request_allowance()
            }
        }
    }
}

use crate::BackendState;

#[derive(Debug, Clone, Copy)]
pub enum ExitTrigger {
    ExitRequested,
    ExitFallback,
}

pub fn try_begin_exit_cleanup<F>(state: &BackendState, trigger: ExitTrigger, log: F) -> bool
where
    F: Fn(&str),
{
    if state.try_begin_exit_cleanup() {
        return true;
    }

    let message = match trigger {
        ExitTrigger::ExitRequested => "exit requested while backend cleanup is already running",
        ExitTrigger::ExitFallback => {
            "exit fallback cleanup skipped: backend cleanup already running"
        }
    };
    log(message);
    false
}

pub fn stop_backend_for_exit<F>(state: &BackendState, trigger: ExitTrigger, log: F)
where
    F: Fn(&str),
{
    let stop_failure_prefix = match trigger {
        ExitTrigger::ExitRequested => "backend graceful stop on ExitRequested failed",
        ExitTrigger::ExitFallback => "backend fallback stop on Exit failed",
    };
    if let Err(error) = state.stop_backend() {
        log(&format!("{stop_failure_prefix}: {error}"));
    }

    if matches!(trigger, ExitTrigger::ExitRequested) {
        log("backend stop finished, exiting desktop process");
    }
}

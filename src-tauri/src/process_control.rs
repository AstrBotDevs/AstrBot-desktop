#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    io,
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};

const FORCE_STOP_WAIT_MIN_MS: u64 = 200;
#[cfg(target_os = "windows")]
const WINDOWS_GRACEFUL_STOP_NONZERO_WAIT_MS: u64 = 350;
#[cfg(target_os = "windows")]
const FORCE_STOP_WAIT_MAX_WINDOWS_MS: u64 = 2_200;
#[cfg(not(target_os = "windows"))]
const FORCE_STOP_WAIT_MAX_NON_WINDOWS_MS: u64 = 1_500;
#[cfg(target_os = "windows")]
const WINDOWS_CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> bool {
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return true,
            Ok(None) => {
                if start.elapsed() >= timeout {
                    return false;
                }
                thread::sleep(Duration::from_millis(120));
            }
            Err(_) => return false,
        }
    }
}

fn run_stop_command<F>(
    pid: u32,
    label: &str,
    program: &str,
    args: &[&str],
    log: F,
) -> io::Result<ExitStatus>
where
    F: Fn(&str) + Copy,
{
    let mut command = Command::new(program);
    command
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null());
    #[cfg(target_os = "windows")]
    {
        // Avoid flashing transient black console windows when invoking taskkill.
        command.creation_flags(WINDOWS_CREATE_NO_WINDOW);
    }
    let status = command.status();

    match &status {
        Ok(exit_status) if exit_status.success() => {}
        Ok(exit_status) => log(&format!(
            "{label} returned non-zero: pid={pid}, status={exit_status:?}"
        )),
        Err(error) => log(&format!(
            "{label} failed to start: pid={pid}, error={error}"
        )),
    }

    status
}

fn compute_followup_wait(timeout: Duration, max_extra_wait: Duration) -> Duration {
    if timeout.is_zero() {
        Duration::ZERO
    } else {
        (timeout / 4)
            .max(Duration::from_millis(FORCE_STOP_WAIT_MIN_MS))
            .min(max_extra_wait)
    }
}

fn resolve_graceful_wait_timeout<F>(
    pid: u32,
    timeout: Duration,
    non_success_wait_cap: Duration,
    graceful_status: &io::Result<ExitStatus>,
    command_label: &str,
    log: F,
) -> Duration
where
    F: Fn(&str) + Copy,
{
    match graceful_status {
        Ok(status) if status.success() => timeout,
        _ => {
            let shortened_wait = timeout.min(non_success_wait_cap);
            if shortened_wait < timeout {
                let outcome = match graceful_status {
                    Ok(status) => format!("status={status:?}"),
                    Err(error) => format!("error={error}"),
                };
                log(&format!(
                    "{command_label} not successful; shorten graceful wait: pid={pid}, {outcome}, requested_wait_ms={}, effective_wait_ms={}",
                    timeout.as_millis(),
                    shortened_wait.as_millis()
                ));
            }
            shortened_wait
        }
    }
}

#[cfg(target_os = "windows")]
pub fn stop_child_process_gracefully<F>(child: &mut Child, timeout: Duration, log: F) -> bool
where
    F: Fn(&str) + Copy,
{
    let pid = child.id();
    let pid_arg = pid.to_string();

    let graceful_status = run_stop_command(
        pid,
        "taskkill graceful stop",
        "taskkill",
        &["/pid", &pid_arg, "/t"],
        log,
    );

    let graceful_wait_timeout = resolve_graceful_wait_timeout(
        pid,
        timeout,
        Duration::from_millis(WINDOWS_GRACEFUL_STOP_NONZERO_WAIT_MS),
        &graceful_status,
        "taskkill graceful stop",
        log,
    );

    if wait_for_child_exit(child, graceful_wait_timeout) {
        return true;
    }

    let force_status = run_stop_command(
        pid,
        "taskkill force stop",
        "taskkill",
        &["/pid", &pid_arg, "/t", "/f"],
        log,
    );

    let followup_wait = compute_followup_wait(
        timeout,
        Duration::from_millis(FORCE_STOP_WAIT_MAX_WINDOWS_MS),
    );
    log(&format!(
        "child graceful stop timed out, force-kill issued: pid={pid}, graceful={graceful_status:?}, force={force_status:?}, followup_wait_ms={}",
        followup_wait.as_millis(),
    ));
    wait_for_child_exit(child, followup_wait)
}

#[cfg(not(target_os = "windows"))]
pub fn stop_child_process_gracefully<F>(child: &mut Child, timeout: Duration, log: F) -> bool
where
    F: Fn(&str) + Copy,
{
    let pid = child.id();
    let pid_arg = pid.to_string();

    let graceful_status = run_stop_command(pid, "kill -TERM", "kill", &["-TERM", &pid_arg], log);

    let graceful_wait_timeout =
        resolve_graceful_wait_timeout(pid, timeout, timeout, &graceful_status, "kill -TERM", log);
    if wait_for_child_exit(child, graceful_wait_timeout) {
        return true;
    }

    let force_status = run_stop_command(pid, "kill -KILL", "kill", &["-KILL", &pid_arg], log);

    let followup_wait = compute_followup_wait(
        timeout,
        Duration::from_millis(FORCE_STOP_WAIT_MAX_NON_WINDOWS_MS),
    );
    log(&format!(
        "child graceful stop timed out, force-kill issued: pid={pid}, graceful={graceful_status:?}, force={force_status:?}, followup_wait_ms={}",
        followup_wait.as_millis(),
    ));

    wait_for_child_exit(child, followup_wait)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[test]
    fn compute_followup_wait_respects_min_and_cap() {
        assert_eq!(
            compute_followup_wait(Duration::from_millis(0), Duration::from_millis(900)),
            Duration::ZERO
        );
        assert_eq!(
            compute_followup_wait(Duration::from_millis(100), Duration::from_millis(900)),
            Duration::from_millis(200)
        );
        assert_eq!(
            compute_followup_wait(Duration::from_millis(9_000), Duration::from_millis(900)),
            Duration::from_millis(900)
        );
    }

    #[test]
    fn resolve_graceful_wait_timeout_shortens_and_logs_on_failure() {
        let logs = Mutex::new(Vec::new());
        let graceful_status: io::Result<ExitStatus> = Err(io::Error::other("simulated failure"));
        let wait = resolve_graceful_wait_timeout(
            42,
            Duration::from_millis(2_000),
            Duration::from_millis(350),
            &graceful_status,
            "taskkill graceful stop",
            |message| logs.lock().expect("lock logs").push(message.to_string()),
        );

        assert_eq!(wait, Duration::from_millis(350));
        let snapshot = logs.lock().expect("lock logs");
        assert_eq!(snapshot.len(), 1);
        assert!(snapshot[0].contains("shorten graceful wait"));
    }
}

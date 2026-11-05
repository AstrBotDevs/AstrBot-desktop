#[cfg(any(target_os = "windows", test))]
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::{
    io,
    process::{Child, Command, ExitStatus, Stdio},
    thread,
    time::{Duration, Instant},
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{
        CloseHandle, ERROR_ACCESS_DENIED, ERROR_INVALID_PARAMETER, ERROR_NOT_FOUND,
        ERROR_NO_MORE_FILES, FILETIME, HANDLE, INVALID_HANDLE_VALUE, STILL_ACTIVE,
    },
    System::{
        Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        Threading::{
            GetExitCodeProcess, GetProcessTimes, OpenProcess, TerminateProcess,
            PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_TERMINATE,
        },
    },
};

/// Identity of a process this shell spawned and still believes it owns.
///
/// `created_at` is the platform creation timestamp when the platform exposes one.
/// Comparing it across probes is what keeps a recycled PID from being mistaken for the
/// backend that was captured before a stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ProcessIdentity {
    pub(crate) pid: u32,
    pub(crate) created_at: Option<u64>,
}

/// Result of a single liveness probe for one PID.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProcessProbe {
    /// No running process owns this PID.
    Missing,
    /// A running process owns this PID; `created_at` is set when the platform reports it.
    Alive { created_at: Option<u64> },
    /// The platform refused to answer. Callers must not read this as proof of exit.
    Unknown,
}

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
fn close_handle(handle: HANDLE) {
    unsafe {
        CloseHandle(handle);
    }
}

#[cfg(any(target_os = "windows", test))]
fn collect_descendant_processes(root_pid: u32, entries: &[(u32, u32)]) -> Vec<u32> {
    let mut children_by_parent: HashMap<u32, Vec<u32>> = HashMap::new();
    for (pid, parent_pid) in entries {
        children_by_parent
            .entry(*parent_pid)
            .or_default()
            .push(*pid);
    }

    let mut tree = Vec::new();
    let mut discovered = HashSet::from([root_pid]);
    let mut stack = vec![root_pid];
    while let Some(parent_pid) = stack.pop() {
        let Some(children) = children_by_parent.get(&parent_pid) else {
            continue;
        };
        for pid in children {
            if discovered.insert(*pid) {
                tree.push(*pid);
                stack.push(*pid);
            }
        }
    }
    tree.push(root_pid);
    tree
}

#[cfg(target_os = "windows")]
fn snapshot_process_tree(root_pid: u32) -> io::Result<Vec<u32>> {
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }

    let mut entries = Vec::new();
    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

    let first_ok = unsafe { Process32FirstW(snapshot, &mut entry) } != 0;
    if !first_ok {
        let error = io::Error::last_os_error();
        close_handle(snapshot);
        return Err(error);
    }

    loop {
        entries.push((entry.th32ProcessID, entry.th32ParentProcessID));
        let next_ok = unsafe { Process32NextW(snapshot, &mut entry) } != 0;
        if !next_ok {
            let error = io::Error::last_os_error();
            if is_process_snapshot_end_error(&error) {
                break;
            }
            close_handle(snapshot);
            return Err(error);
        }
    }
    close_handle(snapshot);

    Ok(collect_descendant_processes(root_pid, &entries))
}

#[cfg(all(test, not(target_os = "windows")))]
const ERROR_ACCESS_DENIED: u32 = 5;
#[cfg(all(test, not(target_os = "windows")))]
const ERROR_INVALID_PARAMETER: u32 = 87;
#[cfg(all(test, not(target_os = "windows")))]
const ERROR_NO_MORE_FILES: u32 = 18;
#[cfg(all(test, not(target_os = "windows")))]
const ERROR_NOT_FOUND: u32 = 1168;

#[cfg(any(target_os = "windows", test))]
fn is_process_snapshot_end_error(error: &io::Error) -> bool {
    let Some(code) = error.raw_os_error() else {
        return false;
    };
    code as u32 == ERROR_NO_MORE_FILES
}

/// Probe a PID for liveness on Windows without trusting any `Child` handle.
///
/// `OpenProcess` fails with `ERROR_INVALID_PARAMETER` only when the PID is truly gone,
/// so it separates "no such process" from "the process exists but denies us access".
/// A live process is additionally stamped with its creation time, which is what makes
/// PID recycling detectable: a recycled PID would come back with a different stamp.
#[cfg(target_os = "windows")]
fn probe_pid_windows(pid: u32) -> ProcessProbe {
    if pid == 0 {
        return ProcessProbe::Missing;
    }

    let handle = unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) };
    if handle.is_null() {
        let error = io::Error::last_os_error();
        return match error.raw_os_error().map(|code| code as u32) {
            Some(ERROR_INVALID_PARAMETER) => ProcessProbe::Missing,
            // The PID still resolves but we may not query it: treat as alive so a
            // permission problem can never be mistaken for a clean exit.
            Some(ERROR_ACCESS_DENIED) => ProcessProbe::Alive { created_at: None },
            _ => ProcessProbe::Unknown,
        };
    }

    let mut exit_code: u32 = 0;
    let exit_code_ok = unsafe { GetExitCodeProcess(handle, &mut exit_code) } != 0;
    if exit_code_ok && exit_code != STILL_ACTIVE as u32 {
        close_handle(handle);
        return ProcessProbe::Missing;
    }

    let created_at = process_creation_time(handle);
    close_handle(handle);

    if !exit_code_ok {
        return ProcessProbe::Unknown;
    }

    ProcessProbe::Alive { created_at }
}

/// Read a process creation timestamp in 100 ns units, matching `FILETIME` semantics.
#[cfg(target_os = "windows")]
fn process_creation_time(handle: HANDLE) -> Option<u64> {
    let mut creation = FILETIME {
        dwLowDateTime: 0,
        dwHighDateTime: 0,
    };
    let mut exit = creation;
    let mut kernel = creation;
    let mut user = creation;
    let ok =
        unsafe { GetProcessTimes(handle, &mut creation, &mut exit, &mut kernel, &mut user) } != 0;
    if !ok {
        return None;
    }

    Some((u64::from(creation.dwHighDateTime) << 32) | u64::from(creation.dwLowDateTime))
}

/// Probe a PID for liveness on Unix via the `/proc` filesystem, which also exposes the
/// process start time needed for recycling detection.
#[cfg(not(target_os = "windows"))]
fn probe_pid_unix(pid: u32) -> ProcessProbe {
    use std::{fs, path::Path};

    if pid == 0 {
        return ProcessProbe::Missing;
    }

    let proc_dir = Path::new("/proc").join(pid.to_string());
    if !proc_dir.exists() {
        return if Path::new("/proc/self").exists() {
            ProcessProbe::Missing
        } else {
            // No procfs: honour POSIX signal 0 as the liveness test instead.
            probe_pid_with_signal(pid)
        };
    }

    let stat = match fs::read_to_string(proc_dir.join("stat")) {
        Ok(stat) => stat,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return ProcessProbe::Missing,
        Err(_) => return ProcessProbe::Unknown,
    };

    // A zombie or dead task still holds a /proc entry but no longer runs, so treat both
    // as exited. Field 3 of /proc/<pid>/stat is the state letter, after the "(name)" tail.
    let state = stat
        .rsplit_once(')')
        .and_then(|(_, trailer)| trailer.trim_start().chars().next());
    if matches!(state, Some('Z') | Some('X') | Some('x')) {
        return ProcessProbe::Missing;
    }

    let created_at = stat
        .rsplit_once(')')
        .and_then(|(_, trailer)| trailer.split_whitespace().nth(19))
        .and_then(|value| value.parse::<u64>().ok());

    ProcessProbe::Alive { created_at }
}

#[cfg(not(target_os = "windows"))]
fn probe_pid_with_signal(pid: u32) -> ProcessProbe {
    // `SystemTime` has no per-process creation stamp, so recycling stays undetectable
    // on exotic platforms; falling back to `Unknown` would be worse than a plain probe.
    match unsafe_libc_kill_zero(pid) {
        Ok(()) => ProcessProbe::Alive { created_at: None },
        Err(()) => ProcessProbe::Missing,
    }
}

#[cfg(not(target_os = "windows"))]
fn unsafe_libc_kill_zero(pid: u32) -> Result<(), ()> {
    // Signal 0 performs the permission and existence checks without delivering a signal.
    let result = std::process::Command::new("kill")
        .args(["-0", &pid.to_string()])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .stdin(Stdio::null())
        .status();
    match result {
        Ok(status) if status.success() => Ok(()),
        _ => Err(()),
    }
}

/// Probe one PID for liveness. Never blocks longer than a couple of system calls.
pub(crate) fn probe_process(pid: u32) -> ProcessProbe {
    #[cfg(target_os = "windows")]
    {
        probe_pid_windows(pid)
    }
    #[cfg(not(target_os = "windows"))]
    {
        probe_pid_unix(pid)
    }
}

fn probe_matches_identity(probe: ProcessProbe, identity: ProcessIdentity) -> bool {
    match probe {
        ProcessProbe::Missing => false,
        ProcessProbe::Unknown => true,
        ProcessProbe::Alive { created_at } => match (identity.created_at, created_at) {
            (Some(expected), Some(actual)) => expected == actual,
            // Without a timestamp on either side the PID alone is all we have, so a
            // live process on that PID must be treated as the old backend.
            _ => true,
        },
    }
}

/// Capture the identity of a still-running process, so later probes can tell the
/// original process apart from a recycled PID.
pub(crate) fn capture_process_identity(pid: u32) -> ProcessIdentity {
    let created_at = match probe_process(pid) {
        ProcessProbe::Alive { created_at } => created_at,
        ProcessProbe::Missing | ProcessProbe::Unknown => None,
    };
    ProcessIdentity { pid, created_at }
}

/// Outcome of waiting for a previously spawned process to disappear.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProcessExitOutcome {
    /// The PID is gone, or it now belongs to a different process.
    Exited,
    /// The PID still answers and still matches the captured identity.
    StillRunning,
}

/// Poll until the captured process is gone or `timeout` elapses.
///
/// This deliberately ignores the `Child` handle. `Child::try_wait` reports `Some` for a
/// handle whose process is long gone, which is exactly how a restart used to conclude
/// "backend stopped" while an unrelated process still held the listening port.
pub(crate) fn wait_for_process_identity_exit(
    identity: ProcessIdentity,
    timeout: Duration,
    poll_interval: Duration,
) -> ProcessExitOutcome {
    wait_for_process_identity_exit_with(identity, timeout, poll_interval, probe_process)
}

/// Same as [`wait_for_process_identity_exit`] with an injectable probe, so the timeout and
/// recycling rules can be exercised without spawning real processes.
pub(crate) fn wait_for_process_identity_exit_with<F>(
    identity: ProcessIdentity,
    timeout: Duration,
    poll_interval: Duration,
    probe: F,
) -> ProcessExitOutcome
where
    F: Fn(u32) -> ProcessProbe,
{
    let start = Instant::now();
    let poll_interval = poll_interval.max(Duration::from_millis(10));

    loop {
        if !probe_matches_identity(probe(identity.pid), identity) {
            return ProcessExitOutcome::Exited;
        }

        if start.elapsed() >= timeout {
            return ProcessExitOutcome::StillRunning;
        }

        let remaining = timeout.saturating_sub(start.elapsed());
        thread::sleep(poll_interval.min(remaining));
    }
}

#[cfg(target_os = "windows")]
fn terminate_process_by_pid(pid: u32) -> io::Result<()> {
    let handle = unsafe { OpenProcess(PROCESS_TERMINATE, 0, pid) };
    if handle.is_null() {
        let error = io::Error::last_os_error();
        if is_expected_shutdown_termination_error(&error) {
            return Ok(());
        }
        return Err(error);
    }

    let result = unsafe { TerminateProcess(handle, 1) };
    let error = if result == 0 {
        Some(io::Error::last_os_error())
    } else {
        None
    };
    close_handle(handle);

    match error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(any(target_os = "windows", test))]
fn is_expected_shutdown_termination_error(error: &io::Error) -> bool {
    let Some(code) = error.raw_os_error() else {
        return false;
    };
    matches!(
        code as u32,
        ERROR_ACCESS_DENIED | ERROR_INVALID_PARAMETER | ERROR_NOT_FOUND
    )
}

#[cfg(target_os = "windows")]
fn terminate_process_tree_native(root_pid: u32, log: &dyn Fn(&str)) {
    let process_tree = match snapshot_process_tree(root_pid) {
        Ok(process_tree) => process_tree,
        Err(error) => {
            log(&format!(
                "native Windows process tree snapshot failed: pid={root_pid}, error={error}"
            ));
            vec![root_pid]
        }
    };

    for pid in process_tree {
        if let Err(error) = terminate_process_by_pid(pid) {
            if !is_expected_shutdown_termination_error(&error) {
                log(&format!(
                    "native Windows process termination failed: pid={pid}, error={error}"
                ));
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub fn stop_child_process_for_system_shutdown<F>(
    child: &mut Child,
    timeout: Duration,
    log: F,
) -> bool
where
    F: Fn(&str) + Copy,
{
    let pid = child.id();
    terminate_process_tree_native(pid, &log);
    wait_for_child_exit(child, timeout)
}

#[cfg(target_os = "windows")]
pub fn stop_child_process_gracefully<F>(child: &mut Child, timeout: Duration, log: F) -> bool
where
    F: Fn(&str) + Copy,
{
    // Normal Windows app exits intentionally keep the existing taskkill-based
    // process-tree cleanup. The system-shutdown path uses native Win32
    // termination instead so it does not launch taskkill.exe during shutdown.
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
    // Normal Unix app exits intentionally keep the existing external kill-based
    // process cleanup.
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
    fn collect_descendant_processes_deduplicates_with_cycles() {
        let tree = collect_descendant_processes(
            10,
            &[(11, 10), (12, 10), (13, 11), (13, 11), (10, 13), (99, 98)],
        );

        assert_eq!(tree.len(), 4);
        assert!(tree.contains(&10));
        assert!(tree.contains(&11));
        assert!(tree.contains(&12));
        assert!(tree.contains(&13));
        assert!(!tree.contains(&99));
        assert_eq!(tree.last(), Some(&10));
    }

    #[test]
    fn expected_shutdown_termination_errors_match_windows_race_codes() {
        for code in [
            ERROR_ACCESS_DENIED,
            ERROR_INVALID_PARAMETER,
            ERROR_NOT_FOUND,
        ] {
            let error = io::Error::from_raw_os_error(code as i32);
            assert!(is_expected_shutdown_termination_error(&error));
        }

        let unexpected = io::Error::from_raw_os_error(123_456);
        assert!(!is_expected_shutdown_termination_error(&unexpected));
        assert!(!is_expected_shutdown_termination_error(&io::Error::other(
            "no os code"
        )));
    }

    #[test]
    fn process_snapshot_end_error_only_matches_no_more_files() {
        let end = io::Error::from_raw_os_error(ERROR_NO_MORE_FILES as i32);
        assert!(is_process_snapshot_end_error(&end));

        let unexpected = io::Error::from_raw_os_error(ERROR_ACCESS_DENIED as i32);
        assert!(!is_process_snapshot_end_error(&unexpected));
        assert!(!is_process_snapshot_end_error(&io::Error::other(
            "no os code"
        )));
    }

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

    fn test_identity(pid: u32, created_at: Option<u64>) -> ProcessIdentity {
        ProcessIdentity { pid, created_at }
    }

    #[test]
    fn missing_probe_never_matches_a_identity() {
        assert!(!probe_matches_identity(
            ProcessProbe::Missing,
            test_identity(42, Some(7))
        ));
        assert!(!probe_matches_identity(
            ProcessProbe::Missing,
            test_identity(42, None)
        ));
    }

    #[test]
    fn alive_probe_matches_only_when_the_creation_stamp_agrees() {
        assert!(probe_matches_identity(
            ProcessProbe::Alive {
                created_at: Some(7)
            },
            test_identity(42, Some(7))
        ));
        assert!(
            !probe_matches_identity(
                ProcessProbe::Alive {
                    created_at: Some(8)
                },
                test_identity(42, Some(7))
            ),
            "a different creation stamp means the PID was recycled"
        );
        assert!(
            probe_matches_identity(
                ProcessProbe::Alive { created_at: None },
                test_identity(42, None)
            ),
            "without timestamps the PID alone is the only evidence left"
        );
        assert!(
            probe_matches_identity(
                ProcessProbe::Alive {
                    created_at: Some(7)
                },
                test_identity(42, None)
            ),
            "an unknown expected stamp must not clear a live PID"
        );
    }

    #[test]
    fn unknown_probe_is_treated_as_still_running() {
        assert!(
            probe_matches_identity(ProcessProbe::Unknown, test_identity(42, Some(7))),
            "a probe the OS refused to answer must never be read as proof of exit"
        );
    }

    #[test]
    fn wait_returns_exited_as_soon_as_the_probe_reports_missing() {
        let outcome = wait_for_process_identity_exit_with(
            test_identity(42, Some(7)),
            Duration::from_millis(1_000),
            Duration::from_millis(10),
            |_| ProcessProbe::Missing,
        );

        assert_eq!(outcome, ProcessExitOutcome::Exited);
    }

    #[test]
    fn wait_returns_still_running_after_the_timeout_elapses() {
        let start = Instant::now();
        let outcome = wait_for_process_identity_exit_with(
            test_identity(42, Some(7)),
            Duration::from_millis(50),
            Duration::from_millis(10),
            |_| ProcessProbe::Alive {
                created_at: Some(7),
            },
        );

        assert_eq!(outcome, ProcessExitOutcome::StillRunning);
        assert!(
            start.elapsed() >= Duration::from_millis(50),
            "the timeout must actually be spent before giving up"
        );
    }

    #[test]
    fn wait_keeps_polling_until_a_late_exit_is_observed() {
        let remaining = Mutex::new(3_u8);
        let outcome = wait_for_process_identity_exit_with(
            test_identity(42, Some(7)),
            Duration::from_millis(2_000),
            Duration::from_millis(10),
            |_| {
                let mut remaining = remaining.lock().expect("lock remaining");
                if *remaining == 0 {
                    ProcessProbe::Missing
                } else {
                    *remaining -= 1;
                    ProcessProbe::Alive {
                        created_at: Some(7),
                    }
                }
            },
        );

        assert_eq!(outcome, ProcessExitOutcome::Exited);
    }

    #[test]
    fn wait_treats_the_current_process_as_alive() {
        // Sanity check of the real probe: this test process is definitely running, so a
        // zero timeout must report it as still there rather than missing.
        let identity = capture_process_identity(std::process::id());
        let outcome =
            wait_for_process_identity_exit(identity, Duration::ZERO, Duration::from_millis(10));
        assert_eq!(outcome, ProcessExitOutcome::StillRunning);
    }

    #[test]
    fn wait_reports_an_impossible_pid_as_exited() {
        // PID 0 is never a real user process on Windows, and the Unix probe rejects it too.
        let identity = test_identity(0, None);
        let outcome = wait_for_process_identity_exit(
            identity,
            Duration::from_millis(50),
            Duration::from_millis(10),
        );
        assert_eq!(outcome, ProcessExitOutcome::Exited);
    }
}

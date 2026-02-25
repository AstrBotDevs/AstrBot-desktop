use std::{path::PathBuf, process::Command};

fn resolve_desktop_git_commit() -> Option<String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let output = match Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
    {
        Ok(output) => output,
        Err(error) => {
            eprintln!(
                "[build.rs] failed to resolve desktop git commit via `git rev-parse HEAD` at {}: {}",
                repo_root.display(),
                error
            );
            return None;
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stderr_trimmed = stderr.trim();
        if stderr_trimmed.is_empty() {
            eprintln!(
                "[build.rs] `git rev-parse HEAD` failed at {} with status {}",
                repo_root.display(),
                output.status
            );
        } else {
            eprintln!(
                "[build.rs] `git rev-parse HEAD` failed at {}: {}",
                repo_root.display(),
                stderr_trimmed
            );
        }
        return None;
    }
    let commit = String::from_utf8(output.stdout).ok()?;
    let trimmed = commit.trim();
    if trimmed.is_empty() {
        eprintln!(
            "[build.rs] resolved empty desktop git commit from {}",
            repo_root.display()
        );
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn main() {
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/packed-refs");

    let desktop_git_commit = resolve_desktop_git_commit().unwrap_or_else(|| "unknown".to_string());
    println!("cargo:rustc-env=ASTRBOT_DESKTOP_GIT_COMMIT={desktop_git_commit}");

    tauri_build::build()
}

use std::{path::PathBuf, process::Command};

fn resolve_desktop_git_commit() -> Option<String> {
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let output = Command::new("git")
        .arg("-C")
        .arg(&repo_root)
        .arg("rev-parse")
        .arg("HEAD")
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let commit = String::from_utf8(output.stdout).ok()?;
    let trimmed = commit.trim();
    if trimmed.is_empty() {
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

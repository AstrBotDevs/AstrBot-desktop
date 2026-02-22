use std::{
    collections::HashSet,
    env,
    ffi::OsString,
    path::{Path, PathBuf},
};

// Path keys are intentionally component-normalized, so entries like `/a/../b`
// and `/b` deduplicate to the same key.
// On Windows we apply ASCII case folding as a best-effort for case-insensitive PATHs.
fn path_key(path: &Path) -> Option<OsString> {
    if path.as_os_str().is_empty() {
        return None;
    }
    let normalized: PathBuf = path.components().collect();
    #[cfg(target_os = "windows")]
    {
        Some(OsString::from(
            normalized.to_string_lossy().to_ascii_lowercase(),
        ))
    }
    #[cfg(not(target_os = "windows"))]
    {
        Some(normalized.into_os_string())
    }
}

fn add_path_candidate(
    candidate: PathBuf,
    seen_keys: &mut HashSet<OsString>,
    prepend_entries: &mut Vec<PathBuf>,
) {
    if !candidate.is_dir() {
        return;
    }
    if let Some(key) = path_key(&candidate) {
        if seen_keys.insert(key) {
            prepend_entries.push(candidate);
        }
    }
}

fn platform_extra_paths() -> Vec<PathBuf> {
    let mut result = Vec::new();

    if let Some(home_dir) = home::home_dir() {
        result.push(home_dir.join(".local").join("bin"));
        #[cfg(target_os = "macos")]
        {
            result.push(home_dir.join(".nvm").join("current").join("bin"));
        }
    }

    if let Some(nvm_bin) = env::var_os("NVM_BIN") {
        result.push(PathBuf::from(nvm_bin));
    }
    if let Some(volta_home) = env::var_os("VOLTA_HOME") {
        result.push(PathBuf::from(volta_home).join("bin"));
    }

    #[cfg(target_os = "macos")]
    {
        for raw in [
            "/opt/homebrew/bin",
            "/opt/homebrew/sbin",
            "/usr/local/bin",
            "/usr/local/sbin",
        ] {
            result.push(PathBuf::from(raw));
        }
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(app_data) = env::var_os("APPDATA") {
            result.push(PathBuf::from(app_data).join("npm"));
        }
        if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
            let local_app_data = PathBuf::from(local_app_data);
            result.push(local_app_data.join("Programs").join("nodejs"));
            result.push(local_app_data.join("nvm"));
        }
    }

    result
}

fn log_backend_path_augmentation<F>(prepend_entries: &[PathBuf], mut log: F)
where
    F: FnMut(String),
{
    if prepend_entries.is_empty() {
        return;
    }
    let preview = prepend_entries
        .iter()
        .map(|entry| entry.display().to_string())
        .collect::<Vec<_>>()
        .join(", ");
    log(format!(
        "backend PATH augmented with {} prepended directories: {preview}",
        prepend_entries.len()
    ));
}

pub fn build_backend_path_override<F>(mut log: F) -> Option<OsString>
where
    F: FnMut(String),
{
    let existing_path = env::var_os("PATH").unwrap_or_default();
    let existing_entries: Vec<PathBuf> = env::split_paths(&existing_path).collect();
    let mut seen_keys: HashSet<OsString> = existing_entries
        .iter()
        .filter_map(|path| path_key(path))
        .collect();
    let mut prepend_entries: Vec<PathBuf> = Vec::new();

    if let Some(extra_path_raw) = env::var_os("ASTRBOT_DESKTOP_EXTRA_PATH") {
        for path in env::split_paths(&extra_path_raw) {
            add_path_candidate(path, &mut seen_keys, &mut prepend_entries);
        }
    }

    for path in platform_extra_paths() {
        add_path_candidate(path, &mut seen_keys, &mut prepend_entries);
    }

    if prepend_entries.is_empty() {
        return None;
    }

    match env::join_paths(prepend_entries.iter().chain(existing_entries.iter())) {
        Ok(path_override) => {
            log_backend_path_augmentation(&prepend_entries, &mut log);
            Some(path_override)
        }
        Err(error) => {
            log(format!("failed to build backend PATH override: {error}"));
            None
        }
    }
}

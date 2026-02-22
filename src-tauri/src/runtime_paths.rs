use std::{
    env,
    path::{Path, PathBuf},
};
use tauri::{path::BaseDirectory, AppHandle, Manager};

pub fn detect_astrbot_source_root() -> Option<PathBuf> {
    let explicit_source_dir = env::var("ASTRBOT_SOURCE_DIR")
        .ok()
        .map(|value| PathBuf::from(value.trim()));
    detect_astrbot_source_root_with(workspace_root_dir(), explicit_source_dir)
}

pub fn default_packaged_root_dir() -> Option<PathBuf> {
    home::home_dir().map(|home| home.join(".astrbot"))
}

pub fn resolve_resource_path<F>(app: &AppHandle, relative_path: &str, log: F) -> Option<PathBuf>
where
    F: Fn(&str),
{
    if let Ok(path) = app.path().resolve(relative_path, BaseDirectory::Resource) {
        if path.exists() {
            return Some(path);
        }
    }

    let updater_resource = Path::new("_up_").join("resources").join(relative_path);
    if let Ok(path) = app
        .path()
        .resolve(&updater_resource, BaseDirectory::Resource)
    {
        if path.exists() {
            return Some(path);
        }
    }

    log(&format!(
        "resource not found: {} (checked direct and _up_/resources)",
        relative_path
    ));
    None
}

pub fn workspace_root_dir() -> PathBuf {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..");
    candidate
        .canonicalize()
        .unwrap_or_else(|_| candidate.to_path_buf())
}

fn detect_astrbot_source_root_with(
    workspace_root: PathBuf,
    explicit_source_dir: Option<PathBuf>,
) -> Option<PathBuf> {
    if let Some(candidate) = explicit_source_dir {
        if is_astrbot_source_dir(&candidate) {
            return Some(candidate.canonicalize().unwrap_or(candidate));
        }
    }

    let candidates = [
        workspace_root.join("vendor").join("AstrBot"),
        workspace_root.join("AstrBot"),
        workspace_root,
    ];
    for candidate in candidates {
        if is_astrbot_source_dir(&candidate) {
            return Some(candidate.canonicalize().unwrap_or(candidate));
        }
    }
    None
}

fn is_astrbot_source_dir(candidate: &Path) -> bool {
    candidate.join("main.py").is_file() && candidate.join("astrbot").is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs::{self, File},
        io::Write,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn create_temp_case_dir(name: &str) -> PathBuf {
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let dir = env::temp_dir().join(format!(
            "astrbot-desktop-runtime-paths-test-{}-{}-{}",
            std::process::id(),
            ts,
            name
        ));
        fs::create_dir_all(&dir).expect("create temp case dir");
        dir
    }

    #[test]
    fn is_astrbot_source_dir_requires_main_py_and_astrbot_dir() {
        let dir = create_temp_case_dir("source-layout");
        let main_py = dir.join("main.py");
        let astrbot_dir = dir.join("astrbot");
        File::create(&main_py)
            .and_then(|mut file| file.write_all(b"print('ok')"))
            .expect("create main.py");
        fs::create_dir_all(&astrbot_dir).expect("create astrbot dir");

        assert!(is_astrbot_source_dir(&dir));
        fs::remove_dir_all(&dir).expect("cleanup temp case dir");
    }

    #[test]
    fn detect_astrbot_source_root_with_prefers_explicit_source_dir() {
        let workspace = create_temp_case_dir("workspace");
        let explicit = create_temp_case_dir("explicit");
        let explicit_main = explicit.join("main.py");
        let explicit_pkg = explicit.join("astrbot");
        File::create(&explicit_main)
            .and_then(|mut file| file.write_all(b"print('ok')"))
            .expect("create explicit main.py");
        fs::create_dir_all(&explicit_pkg).expect("create explicit astrbot dir");

        let detected = detect_astrbot_source_root_with(workspace.clone(), Some(explicit.clone()))
            .expect("expected explicit source dir to be detected");
        assert_eq!(
            detected,
            explicit
                .canonicalize()
                .expect("canonicalize explicit source dir")
        );

        fs::remove_dir_all(&workspace).expect("cleanup workspace dir");
        fs::remove_dir_all(&explicit).expect("cleanup explicit dir");
    }
}

use std::{
    env, fs,
    path::{Path, PathBuf},
};

use tauri::AppHandle;

use crate::{packaged_webui, runtime_paths, LaunchPlan, RuntimeManifest};

pub fn resolve_custom_launch(custom_cmd: String) -> Result<LaunchPlan, String> {
    let mut pieces = shlex::split(&custom_cmd)
        .ok_or_else(|| format!("Invalid ASTRBOT_BACKEND_CMD: {custom_cmd}"))?;
    if pieces.is_empty() {
        return Err("ASTRBOT_BACKEND_CMD is empty.".to_string());
    }

    let cmd = pieces.remove(0);
    let cwd = env::var("ASTRBOT_BACKEND_CWD")
        .map(PathBuf::from)
        .ok()
        .or_else(runtime_paths::detect_astrbot_source_root)
        .unwrap_or_else(runtime_paths::workspace_root_dir);
    let root_dir = env::var("ASTRBOT_ROOT").ok().map(PathBuf::from);
    let webui_dir = env::var("ASTRBOT_WEBUI_DIR").ok().map(PathBuf::from);

    Ok(LaunchPlan {
        cmd,
        args: pieces,
        cwd,
        root_dir,
        webui_dir,
        packaged_mode: false,
    })
}

pub fn resolve_packaged_launch<F>(
    app: &AppHandle,
    default_shell_locale: &'static str,
    log: F,
) -> Result<Option<LaunchPlan>, String>
where
    F: Fn(&str) + Copy,
{
    let manifest_path =
        match runtime_paths::resolve_resource_path(app, "backend/runtime-manifest.json", log) {
            Some(path) if path.is_file() => path,
            _ => return Ok(None),
        };
    let backend_dir = manifest_path
        .parent()
        .ok_or_else(|| format!("Invalid backend manifest path: {}", manifest_path.display()))?;

    let manifest_text = fs::read_to_string(&manifest_path).map_err(|error| {
        format!(
            "Failed to read packaged backend manifest {}: {}",
            manifest_path.display(),
            error
        )
    })?;
    let manifest: RuntimeManifest = serde_json::from_str(&manifest_text).map_err(|error| {
        format!(
            "Failed to parse packaged backend manifest {}: {}",
            manifest_path.display(),
            error
        )
    })?;

    let default_python_relative = if cfg!(target_os = "windows") {
        PathBuf::from("python").join("Scripts").join("python.exe")
    } else {
        PathBuf::from("python").join("bin").join("python3")
    };
    let python_path = backend_dir.join(
        manifest
            .python
            .as_deref()
            .map(PathBuf::from)
            .unwrap_or(default_python_relative),
    );
    if !python_path.is_file() {
        return Err(format!(
            "Packaged runtime python executable is missing: {}",
            python_path.display()
        ));
    }

    let entrypoint_relative = manifest
        .entrypoint
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("launch_backend.py"));
    let launch_script_path = backend_dir.join(entrypoint_relative);
    if !launch_script_path.is_file() {
        return Err(format!(
            "Packaged backend launch script is missing: {}",
            launch_script_path.display()
        ));
    }

    let root_dir = env::var("ASTRBOT_ROOT")
        .map(PathBuf::from)
        .ok()
        .or_else(runtime_paths::default_packaged_root_dir);
    let cwd = env::var("ASTRBOT_BACKEND_CWD")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            root_dir
                .clone()
                .unwrap_or_else(|| backend_dir.to_path_buf())
        });
    let embedded_webui_dir = env::var("ASTRBOT_WEBUI_DIR")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            runtime_paths::resolve_resource_path(app, "webui/index.html", log)
                .and_then(|index_path| index_path.parent().map(Path::to_path_buf))
        });
    let webui_dir = packaged_webui::resolve_packaged_webui_dir(
        embedded_webui_dir,
        root_dir.as_deref(),
        default_shell_locale,
        log,
    )?;

    let args = vec![
        launch_script_path.to_string_lossy().to_string(),
        "--webui-dir".to_string(),
        webui_dir.to_string_lossy().to_string(),
    ];

    let plan = LaunchPlan {
        cmd: python_path.to_string_lossy().to_string(),
        args,
        cwd,
        root_dir,
        webui_dir: Some(webui_dir),
        packaged_mode: true,
    };
    Ok(Some(plan))
}

pub fn resolve_dev_launch() -> Result<LaunchPlan, String> {
    let source_root = runtime_paths::detect_astrbot_source_root().ok_or_else(|| {
        "Cannot locate AstrBot source directory. Set ASTRBOT_SOURCE_DIR, or configure ASTRBOT_SOURCE_GIT_URL/ASTRBOT_SOURCE_GIT_REF and run resource prepare.".to_string()
    })?;

    let mut args = vec!["run".to_string(), "main.py".to_string()];
    let webui_dir = env::var("ASTRBOT_WEBUI_DIR")
        .ok()
        .map(PathBuf::from)
        .or_else(|| {
            let candidate = source_root.join("dashboard").join("dist");
            if candidate.join("index.html").is_file() {
                Some(candidate)
            } else {
                None
            }
        });
    if let Some(path) = &webui_dir {
        args.push("--webui-dir".to_string());
        args.push(path.to_string_lossy().to_string());
    }

    Ok(LaunchPlan {
        cmd: "uv".to_string(),
        args,
        cwd: env::var("ASTRBOT_BACKEND_CWD")
            .map(PathBuf::from)
            .unwrap_or(source_root),
        root_dir: env::var("ASTRBOT_ROOT").ok().map(PathBuf::from),
        webui_dir,
        packaged_mode: false,
    })
}

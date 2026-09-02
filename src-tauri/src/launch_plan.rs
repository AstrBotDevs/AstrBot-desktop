use std::{
    collections::HashSet,
    env, fs,
    io::Read,
    path::{Component, Path, PathBuf},
};

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::{
    app_types::RuntimeWebuiEntryDigest,
    backend, packaged_webui,
    runtime_paths::{self, PackagedResourceLocation},
    LaunchPlan, RuntimeManifest, RuntimeWebuiAttestation,
};

const BACKEND_RESOURCE_ALIAS: &str = env!("ASTRBOT_BACKEND_RESOURCE_ALIAS");
const WEBUI_RESOURCE_ALIAS: &str = env!("ASTRBOT_WEBUI_RESOURCE_ALIAS");
const PACKAGED_RUNTIME_MANIFEST_SHA256: &str = env!("ASTRBOT_RUNTIME_MANIFEST_SHA256");

fn should_attempt_packaged_launch(debug_assertions_enabled: bool) -> bool {
    !debug_assertions_enabled
}

#[derive(Debug)]
struct PackagedResourceCandidate {
    label: &'static str,
    backend_dir: PathBuf,
    webui_dir: PathBuf,
}

#[derive(Debug)]
struct PackagedResourceFailure {
    label: &'static str,
    reason: String,
}

#[derive(Debug)]
struct ResolvedPackagedResources {
    label: &'static str,
    core_version: String,
    python_path: PathBuf,
    launch_script_path: PathBuf,
    webui_dir: PathBuf,
    runtime_manifest_sha256: String,
    webui_index_sha256: String,
    webui_entry_digests: Vec<RuntimeWebuiEntryDigest>,
    rejected: Vec<PackagedResourceFailure>,
}

fn resolve_packaged_resource_candidate(
    app: &AppHandle,
    location: PackagedResourceLocation,
) -> Result<PackagedResourceCandidate, PackagedResourceFailure> {
    let label = location.label();
    let backend_dir =
        runtime_paths::resolve_packaged_resource_path(app, location, BACKEND_RESOURCE_ALIAS)
            .map_err(|reason| PackagedResourceFailure { label, reason })?;
    let webui_dir =
        runtime_paths::resolve_packaged_resource_path(app, location, WEBUI_RESOURCE_ALIAS)
            .map_err(|reason| PackagedResourceFailure { label, reason })?;

    Ok(PackagedResourceCandidate {
        label,
        backend_dir,
        webui_dir,
    })
}

fn normalize_resource_version(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let normalized = trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed);
    if normalized.is_empty() {
        return Err(format!("{field} is empty"));
    }
    Ok(normalized.to_string())
}

fn required_manifest_version(value: Option<&str>, field: &str) -> Result<String, String> {
    let value = value.ok_or_else(|| format!("runtime-manifest.json is missing {field}"))?;
    normalize_resource_version(value, &format!("runtime-manifest.json {field}"))
}

fn packaged_webui_cache_version(runtime_manifest_sha256: &str) -> String {
    format!("v1-{runtime_manifest_sha256}")
}

fn normalize_sha256(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim().to_ascii_lowercase();
    if normalized.len() != 64 || !normalized.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("{field} must be a SHA-256 digest"));
    }
    Ok(normalized)
}

fn resolve_manifest_file(
    root: &Path,
    relative_path: &Path,
    field: &str,
    description: &str,
) -> Result<PathBuf, String> {
    if relative_path.as_os_str().is_empty()
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(format!(
            "runtime-manifest.json {field} must be a canonical relative path inside {}",
            root.display()
        ));
    }
    let candidate = root.join(relative_path);
    if !candidate.is_file() {
        return Err(format!("{description} is missing: {}", candidate.display()));
    }
    let canonical_root = fs::canonicalize(root).map_err(|error| {
        format!(
            "cannot resolve packaged resource directory {}: {}",
            root.display(),
            error
        )
    })?;
    let canonical_candidate = fs::canonicalize(&candidate).map_err(|error| {
        format!(
            "cannot resolve packaged resource file {}: {}",
            candidate.display(),
            error
        )
    })?;
    if !canonical_candidate.starts_with(&canonical_root) {
        return Err(format!(
            "runtime-manifest.json {field} escapes packaged resource directory {}",
            root.display()
        ));
    }
    Ok(canonical_candidate)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .map_err(|error| format!("cannot open {} for hashing: {}", path.display(), error))?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| format!("cannot hash {}: {}", path.display(), error))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn sha256_bytes(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn validate_webui_attestation(
    webui_dir: &Path,
    core_version: &str,
    attestation: &RuntimeWebuiAttestation,
) -> Result<(String, Vec<RuntimeWebuiEntryDigest>), String> {
    let attested_version =
        normalize_resource_version(&attestation.version, "WebUI bundle attestation version")?;
    if attested_version != core_version {
        return Err(format!(
            "Core/WebUI attestation version mismatch: Core is {core_version}, attestation is {attested_version}"
        ));
    }

    let webui_index = resolve_manifest_file(
        webui_dir,
        Path::new("index.html"),
        "webui.index",
        "WebUI index",
    )?;
    let expected_index_sha256 = normalize_sha256(
        &attestation.index_sha256,
        "runtime-manifest.json webui.indexSha256",
    )?;
    let actual_index_sha256 = sha256_file(&webui_index)?;
    if actual_index_sha256 != expected_index_sha256 {
        return Err(format!(
            "WebUI index digest mismatch: expected {expected_index_sha256}, got {actual_index_sha256}"
        ));
    }

    let mut seen_entries = HashSet::new();
    let mut has_javascript_entry = false;
    let mut validated_entries = Vec::with_capacity(attestation.entry_assets.len());
    for entry in &attestation.entry_assets {
        let normalized_entry_path = entry.path.trim().replace('\\', "/");
        let relative = PathBuf::from(&normalized_entry_path);
        if !seen_entries.insert(relative.clone()) {
            return Err(format!(
                "runtime-manifest.json contains duplicate WebUI entry asset: {}",
                entry.path
            ));
        }
        let extension = relative
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if extension.eq_ignore_ascii_case("js") {
            has_javascript_entry = true;
        } else if !extension.eq_ignore_ascii_case("css") {
            return Err(format!(
                "runtime-manifest.json contains unsupported WebUI entry asset: {}",
                entry.path
            ));
        }
        let entry_path = resolve_manifest_file(
            webui_dir,
            &relative,
            "webui.entryAssets[].path",
            "WebUI entry asset",
        )?;
        let expected_sha256 = normalize_sha256(
            &entry.sha256,
            "runtime-manifest.json webui.entryAssets[].sha256",
        )?;
        let actual_sha256 = sha256_file(&entry_path)?;
        if actual_sha256 != expected_sha256 {
            return Err(format!(
                "WebUI entry asset digest mismatch for {}: expected {}, got {}",
                entry.path, expected_sha256, actual_sha256
            ));
        }
        validated_entries.push(RuntimeWebuiEntryDigest {
            path: normalized_entry_path,
            sha256: expected_sha256,
        });
    }
    if !has_javascript_entry {
        return Err("WebUI bundle attestation has no JavaScript entry asset".to_string());
    }
    Ok((actual_index_sha256, validated_entries))
}

fn validate_packaged_resource_candidate(
    candidate: PackagedResourceCandidate,
    expected_desktop_version: &str,
    expected_runtime_manifest_sha256: &str,
) -> Result<ResolvedPackagedResources, String> {
    let manifest_path = candidate.backend_dir.join("runtime-manifest.json");
    let manifest_bytes = fs::read(&manifest_path).map_err(|error| {
        format!(
            "cannot read backend manifest {}: {}",
            manifest_path.display(),
            error
        )
    })?;
    let expected_runtime_manifest_sha256 = normalize_sha256(
        expected_runtime_manifest_sha256,
        "executable packaged runtime manifest identity",
    )?;
    let runtime_manifest_sha256 = sha256_bytes(&manifest_bytes);
    if runtime_manifest_sha256 != expected_runtime_manifest_sha256 {
        return Err(format!(
            "Packaged runtime manifest identity mismatch: executable expects {expected_runtime_manifest_sha256}, candidate has {runtime_manifest_sha256}"
        ));
    }
    let manifest: RuntimeManifest = serde_json::from_slice(&manifest_bytes).map_err(|error| {
        format!(
            "cannot parse backend manifest {}: {}",
            manifest_path.display(),
            error
        )
    })?;

    let expected_desktop_version =
        normalize_resource_version(expected_desktop_version, "running Desktop version")?;
    let desktop_version =
        required_manifest_version(manifest.desktop_version.as_deref(), "desktopVersion")?;
    if desktop_version != expected_desktop_version {
        return Err(format!(
            "Desktop version mismatch: manifest has {desktop_version}, running executable is {expected_desktop_version}"
        ));
    }
    let core_version = required_manifest_version(manifest.core_version.as_deref(), "coreVersion")?;
    let desktop_semver = semver::Version::parse(&expected_desktop_version).map_err(|error| {
        format!(
            "running Desktop version {expected_desktop_version} is not valid semantic version: {error}"
        )
    })?;
    if desktop_semver.pre.is_empty() && core_version != expected_desktop_version {
        return Err(format!(
            "Stable Desktop/Core version mismatch: Desktop is {expected_desktop_version}, Core is {core_version}"
        ));
    }

    let default_python_relative = if cfg!(target_os = "windows") {
        PathBuf::from("python").join("Scripts").join("python.exe")
    } else {
        PathBuf::from("python").join("bin").join("python3")
    };
    let python_relative = manifest
        .python
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or(default_python_relative);
    let python_path = resolve_manifest_file(
        &candidate.backend_dir,
        &python_relative,
        "python",
        "backend Python executable",
    )?;

    let entrypoint_relative = manifest
        .entrypoint
        .as_deref()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("launch_backend.py"));
    let launch_script_path = resolve_manifest_file(
        &candidate.backend_dir,
        &entrypoint_relative,
        "entrypoint",
        "backend entrypoint",
    )?;

    let attestation = manifest.webui.as_ref().ok_or_else(|| {
        "runtime-manifest.json is missing the WebUI bundle attestation".to_string()
    })?;
    let (webui_index_sha256, webui_entry_digests) =
        validate_webui_attestation(&candidate.webui_dir, &core_version, attestation)?;
    let webui_version_path = candidate.webui_dir.join("assets").join("version");
    let webui_version_raw = fs::read_to_string(&webui_version_path).map_err(|error| {
        format!(
            "cannot read WebUI version marker {}: {}",
            webui_version_path.display(),
            error
        )
    })?;
    let webui_version = normalize_resource_version(&webui_version_raw, "WebUI version marker")?;
    if webui_version != core_version {
        return Err(format!(
            "Core/WebUI version mismatch: Core is {core_version}, WebUI is {webui_version}"
        ));
    }

    Ok(ResolvedPackagedResources {
        label: candidate.label,
        core_version,
        python_path,
        launch_script_path,
        webui_dir: candidate.webui_dir,
        runtime_manifest_sha256,
        webui_index_sha256,
        webui_entry_digests,
        rejected: Vec::new(),
    })
}

fn select_packaged_resources(
    expected_desktop_version: &str,
    expected_runtime_manifest_sha256: &str,
    candidates: Vec<Result<PackagedResourceCandidate, PackagedResourceFailure>>,
) -> Result<ResolvedPackagedResources, Vec<PackagedResourceFailure>> {
    let mut failures = Vec::new();
    for candidate in candidates {
        let candidate = match candidate {
            Ok(candidate) => candidate,
            Err(failure) => {
                failures.push(failure);
                continue;
            }
        };
        let label = candidate.label;
        match validate_packaged_resource_candidate(
            candidate,
            expected_desktop_version,
            expected_runtime_manifest_sha256,
        ) {
            Ok(mut resolved) => {
                resolved.rejected = failures;
                return Ok(resolved);
            }
            Err(reason) => failures.push(PackagedResourceFailure { label, reason }),
        }
    }
    Err(failures)
}

fn packaged_resources_unavailable_error(
    expected_desktop_version: &str,
    failures: &[PackagedResourceFailure],
) -> String {
    let details = failures
        .iter()
        .map(|failure| format!("{}: {}", failure.label, failure.reason))
        .collect::<Vec<_>>()
        .join("; ");
    format!(
        "Packaged resources are unavailable for AstrBot Desktop {expected_desktop_version}. {details}. Please run the Desktop update again or reinstall AstrBot with the matching full installer."
    )
}

fn resolve_launch_startup_heartbeat_path(
    root_dir: Option<&Path>,
    packaged_mode: bool,
) -> Option<PathBuf> {
    backend::config::resolve_backend_startup_heartbeat_path(
        root_dir,
        packaged_mode
            .then(runtime_paths::default_packaged_root_dir)
            .flatten(),
        crate::DEFAULT_BACKEND_STARTUP_HEARTBEAT_RELATIVE_PATH,
    )
}

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
    let root_dir = env::var(crate::ASTRBOT_ROOT_ENV).ok().map(PathBuf::from);
    let webui_dir = env::var("ASTRBOT_WEBUI_DIR").ok().map(PathBuf::from);
    let startup_heartbeat_path = resolve_launch_startup_heartbeat_path(root_dir.as_deref(), false);

    Ok(LaunchPlan {
        cmd,
        args: pieces,
        cwd,
        root_dir,
        webui_dir,
        webui_cache_version: None,
        packaged_core_version: None,
        packaged_webui_index_sha256: None,
        packaged_webui_entry_digests: None,
        startup_heartbeat_path,
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
    if !should_attempt_packaged_launch(cfg!(debug_assertions)) {
        log("skipping packaged resource resolution in a debug/development build");
        return Ok(None);
    }

    let expected_desktop_version = app.package_info().version.to_string();
    let candidates = [
        PackagedResourceLocation::Direct,
        PackagedResourceLocation::UpdaterStaging,
    ]
    .into_iter()
    .map(|location| resolve_packaged_resource_candidate(app, location))
    .collect::<Vec<_>>();
    let selected = match select_packaged_resources(
        &expected_desktop_version,
        PACKAGED_RUNTIME_MANIFEST_SHA256,
        candidates,
    ) {
        Ok(selected) => selected,
        Err(failures) => {
            return Err(packaged_resources_unavailable_error(
                &expected_desktop_version,
                &failures,
            ));
        }
    };
    for failure in &selected.rejected {
        log(&format!(
            "rejected packaged resource candidate {}: {}",
            failure.label, failure.reason
        ));
    }
    log(&format!(
        "using {} packaged resource bundle for Desktop {}, Core {}",
        selected.label, expected_desktop_version, selected.core_version
    ));
    if env::var_os("ASTRBOT_WEBUI_DIR").is_some() {
        log(
            "ignoring ASTRBOT_WEBUI_DIR in packaged mode to preserve Backend/WebUI bundle identity",
        );
    }

    let root_dir = env::var(crate::ASTRBOT_ROOT_ENV)
        .map(PathBuf::from)
        .ok()
        .or_else(runtime_paths::default_packaged_root_dir);
    let cwd = env::var("ASTRBOT_BACKEND_CWD")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            root_dir.clone().unwrap_or_else(|| {
                selected
                    .launch_script_path
                    .parent()
                    .map(Path::to_path_buf)
                    .unwrap_or_else(runtime_paths::workspace_root_dir)
            })
        });
    let selected_webui_dir = selected.webui_dir;
    let webui_dir = packaged_webui::resolve_packaged_webui_dir(
        Some(selected_webui_dir.clone()),
        root_dir.as_deref(),
        default_shell_locale,
        log,
    )?;
    if webui_dir != selected_webui_dir {
        return Err(
            "Selected packaged WebUI became unavailable; refusing to use data/dist outside the selected resource bundle. Please run the Desktop update again or reinstall AstrBot."
                .to_string(),
        );
    }
    let webui_index_sha256 = selected.webui_index_sha256;
    let webui_entry_digests = selected.webui_entry_digests;
    let webui_cache_version = packaged_webui_cache_version(&selected.runtime_manifest_sha256);

    let args = vec![
        selected.launch_script_path.to_string_lossy().to_string(),
        "--webui-dir".to_string(),
        webui_dir.to_string_lossy().to_string(),
    ];
    let startup_heartbeat_path = resolve_launch_startup_heartbeat_path(root_dir.as_deref(), true);

    let plan = LaunchPlan {
        cmd: selected.python_path.to_string_lossy().to_string(),
        args,
        cwd,
        root_dir,
        webui_dir: Some(webui_dir),
        webui_cache_version: Some(webui_cache_version),
        packaged_core_version: Some(selected.core_version),
        packaged_webui_index_sha256: Some(webui_index_sha256),
        packaged_webui_entry_digests: Some(webui_entry_digests),
        startup_heartbeat_path,
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
    let root_dir = env::var(crate::ASTRBOT_ROOT_ENV).ok().map(PathBuf::from);
    let startup_heartbeat_path = resolve_launch_startup_heartbeat_path(root_dir.as_deref(), false);

    Ok(LaunchPlan {
        cmd: "uv".to_string(),
        args,
        cwd: env::var("ASTRBOT_BACKEND_CWD")
            .map(PathBuf::from)
            .unwrap_or(source_root),
        root_dir,
        webui_dir,
        webui_cache_version: None,
        packaged_core_version: None,
        packaged_webui_index_sha256: None,
        packaged_webui_entry_digests: None,
        startup_heartbeat_path,
        packaged_mode: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const DESKTOP_VERSION: &str = "4.27.4";
    const CORE_VERSION: &str = "4.27.4";

    fn create_bundle_candidate(
        temp_dir: &TempDir,
        directory_name: &str,
        label: &'static str,
        desktop_version: &str,
        core_version: &str,
        webui_version: &str,
    ) -> PackagedResourceCandidate {
        let resource_root = temp_dir.path().join(directory_name);
        let backend_dir = resource_root.join("backend");
        let webui_dir = resource_root.join("webui");
        fs::create_dir_all(&backend_dir).expect("create backend fixture");
        fs::create_dir_all(webui_dir.join("assets")).expect("create WebUI fixture");

        fs::write(backend_dir.join("python-test"), b"python fixture")
            .expect("write Python fixture");
        fs::write(backend_dir.join("launch_backend.py"), b"print('fixture')\n")
            .expect("write entrypoint fixture");
        fs::write(
            webui_dir.join("index.html"),
            b"<!doctype html><script src=\"/assets/index-test.js\"></script>",
        )
        .expect("write WebUI index fixture");
        fs::write(
            webui_dir.join("assets").join("index-test.js"),
            b"export {};\n",
        )
        .expect("write WebUI entry fixture");
        fs::write(
            webui_dir.join("assets").join("version"),
            format!("{webui_version}\n"),
        )
        .expect("write WebUI version fixture");
        let manifest = serde_json::json!({
            "python": "python-test",
            "entrypoint": "launch_backend.py",
            "desktopVersion": desktop_version,
            "coreVersion": core_version,
            "webui": {
                "version": webui_version,
                "indexSha256": sha256_file(&webui_dir.join("index.html"))
                    .expect("hash WebUI index fixture"),
                "entryAssets": [{
                    "path": "assets/index-test.js",
                    "sha256": sha256_file(&webui_dir.join("assets").join("index-test.js"))
                        .expect("hash WebUI entry fixture"),
                }],
            },
        });
        fs::write(
            backend_dir.join("runtime-manifest.json"),
            serde_json::to_vec(&manifest).expect("serialize manifest fixture"),
        )
        .expect("write manifest fixture");

        PackagedResourceCandidate {
            label,
            backend_dir,
            webui_dir,
        }
    }

    fn set_manifest_field(candidate: &PackagedResourceCandidate, field: &str, value: &str) {
        let manifest_path = candidate.backend_dir.join("runtime-manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read manifest fixture"))
                .expect("parse manifest fixture");
        manifest[field] = serde_json::Value::String(value.to_string());
        fs::write(
            manifest_path,
            serde_json::to_vec(&manifest).expect("serialize modified manifest fixture"),
        )
        .expect("write modified manifest fixture");
    }

    fn replace_attested_entry(candidate: &PackagedResourceCandidate, contents: &[u8]) {
        let entry_path = candidate.webui_dir.join("assets").join("index-test.js");
        fs::write(&entry_path, contents).expect("replace WebUI entry fixture");
        let manifest_path = candidate.backend_dir.join("runtime-manifest.json");
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest_path).expect("read manifest fixture"))
                .expect("parse manifest fixture");
        manifest["webui"]["entryAssets"][0]["sha256"] =
            serde_json::Value::String(sha256_file(&entry_path).expect("hash replacement entry"));
        fs::write(
            manifest_path,
            serde_json::to_vec(&manifest).expect("serialize modified manifest fixture"),
        )
        .expect("write modified manifest fixture");
    }

    fn candidate_manifest_sha256(candidate: &PackagedResourceCandidate) -> String {
        sha256_file(&candidate.backend_dir.join("runtime-manifest.json"))
            .expect("hash runtime manifest fixture")
    }

    fn validate_fixture_candidate(
        candidate: PackagedResourceCandidate,
        desktop_version: &str,
    ) -> Result<ResolvedPackagedResources, String> {
        let expected_manifest_sha256 = candidate_manifest_sha256(&candidate);
        validate_packaged_resource_candidate(candidate, desktop_version, &expected_manifest_sha256)
    }

    struct EnvVarGuard {
        key: &'static str,
        previous: Option<String>,
    }

    impl EnvVarGuard {
        fn set(key: &'static str, value: &str) -> Self {
            let previous = env::var(key).ok();
            env::set_var(key, value);
            Self { key, previous }
        }
    }

    impl Drop for EnvVarGuard {
        fn drop(&mut self) {
            match &self.previous {
                Some(value) => env::set_var(self.key, value),
                None => env::remove_var(self.key),
            }
        }
    }

    #[test]
    fn debug_builds_skip_packaged_launch_while_release_builds_keep_it() {
        assert!(!should_attempt_packaged_launch(true));
        assert!(should_attempt_packaged_launch(false));
    }

    #[test]
    fn valid_direct_bundle_is_preferred_over_valid_updater_bundle() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let direct = create_bundle_candidate(
            &temp_dir,
            "direct",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        let expected_webui_dir = direct.webui_dir.clone();
        let updater = create_bundle_candidate(
            &temp_dir,
            "updater",
            "_up_/resources",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        let expected_manifest_sha256 = candidate_manifest_sha256(&direct);

        let selected = select_packaged_resources(
            DESKTOP_VERSION,
            &expected_manifest_sha256,
            vec![Ok(direct), Ok(updater)],
        )
        .expect("select direct bundle");

        assert_eq!(selected.label, "direct");
        assert_eq!(selected.webui_dir, expected_webui_dir);
        assert!(selected.rejected.is_empty());
    }

    #[test]
    fn same_version_stale_direct_bundle_falls_back_to_executable_bound_updater_bundle() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let direct = create_bundle_candidate(
            &temp_dir,
            "direct",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        set_manifest_field(&direct, "sourceCommit", &"a".repeat(40));
        let updater = create_bundle_candidate(
            &temp_dir,
            "updater",
            "_up_/resources",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        let expected_manifest_sha256 = candidate_manifest_sha256(&updater);

        let selected = select_packaged_resources(
            DESKTOP_VERSION,
            &expected_manifest_sha256,
            vec![Ok(direct), Ok(updater)],
        )
        .expect("fall back to updater bundle");

        assert_eq!(selected.label, "_up_/resources");
        assert_eq!(selected.rejected.len(), 1);
        assert!(selected.rejected[0]
            .reason
            .contains("runtime manifest identity mismatch"));
    }

    #[test]
    fn executable_manifest_identity_rejects_a_coherent_same_version_bundle() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let candidate = create_bundle_candidate(
            &temp_dir,
            "coherent-old",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        let different_executable_identity = "f".repeat(64);

        let error = validate_packaged_resource_candidate(
            candidate,
            DESKTOP_VERSION,
            &different_executable_identity,
        )
        .expect_err("same-version bundle not bound to this executable must fail");

        assert!(error.contains("runtime manifest identity mismatch"));
        assert!(error.contains(&different_executable_identity));
    }

    #[test]
    fn entry_only_change_produces_a_new_full_cache_identity() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let original = create_bundle_candidate(
            &temp_dir,
            "original",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        let changed = create_bundle_candidate(
            &temp_dir,
            "changed",
            "_up_/resources",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        replace_attested_entry(&changed, b"export const changed = true;\n");

        let original_identity = candidate_manifest_sha256(&original);
        let changed_identity = candidate_manifest_sha256(&changed);

        assert_ne!(original_identity, changed_identity);
        assert_ne!(
            packaged_webui_cache_version(&original_identity),
            packaged_webui_cache_version(&changed_identity)
        );
        assert_eq!(
            packaged_webui_cache_version(&changed_identity),
            format!("v1-{changed_identity}")
        );
    }

    #[test]
    fn backend_and_webui_are_never_mixed_across_resource_roots() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let direct = create_bundle_candidate(
            &temp_dir,
            "direct",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        fs::remove_file(direct.webui_dir.join("index.html")).expect("remove direct WebUI index");
        let updater = create_bundle_candidate(
            &temp_dir,
            "updater",
            "_up_/resources",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        fs::remove_file(updater.backend_dir.join("runtime-manifest.json"))
            .expect("remove updater backend manifest");
        let expected_manifest_sha256 = candidate_manifest_sha256(&direct);

        let failures = select_packaged_resources(
            DESKTOP_VERSION,
            &expected_manifest_sha256,
            vec![Ok(direct), Ok(updater)],
        )
        .expect_err("partial roots must not be combined");
        let error = packaged_resources_unavailable_error(DESKTOP_VERSION, &failures);

        assert_eq!(failures.len(), 2);
        assert!(error.contains("direct: WebUI index is missing"));
        assert!(error.contains("_up_/resources: cannot read backend manifest"));
        assert!(error.contains("run the Desktop update again or reinstall"));
    }

    #[test]
    fn incomplete_backend_or_webui_files_are_rejected() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let cases = [
            (
                "missing-python",
                false,
                "python-test",
                "backend Python executable is missing",
            ),
            (
                "missing-entrypoint",
                false,
                "launch_backend.py",
                "backend entrypoint is missing",
            ),
            (
                "missing-index",
                true,
                "index.html",
                "WebUI index is missing",
            ),
            (
                "missing-entry-asset",
                true,
                "assets/index-test.js",
                "WebUI entry asset is missing",
            ),
            (
                "missing-version-marker",
                true,
                "assets/version",
                "cannot read WebUI version marker",
            ),
        ];

        for (directory_name, remove_from_webui, missing_relative_path, expected_error) in cases {
            let candidate = create_bundle_candidate(
                &temp_dir,
                directory_name,
                "direct",
                DESKTOP_VERSION,
                CORE_VERSION,
                "v4.27.4",
            );
            let missing_path = if remove_from_webui {
                candidate.webui_dir.join(missing_relative_path)
            } else {
                candidate.backend_dir.join(missing_relative_path)
            };
            fs::remove_file(missing_path).expect("remove required fixture file");

            let error = validate_fixture_candidate(candidate, DESKTOP_VERSION)
                .expect_err("incomplete candidate must fail");
            assert!(error.contains(expected_error), "unexpected error: {error}");
        }
    }

    #[test]
    fn core_and_webui_versions_must_match() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let candidate = create_bundle_candidate(
            &temp_dir,
            "direct",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.3",
        );

        let error = validate_fixture_candidate(candidate, DESKTOP_VERSION)
            .expect_err("version mismatch must fail");

        assert!(error.contains("Core/WebUI attestation version mismatch"));
        assert!(error.contains("Core is 4.27.4, attestation is 4.27.3"));
    }

    #[test]
    fn stable_desktop_rejects_a_different_matching_core_and_webui_version() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let candidate = create_bundle_candidate(
            &temp_dir,
            "direct",
            "direct",
            DESKTOP_VERSION,
            "4.27.3",
            "v4.27.3",
        );

        let error = validate_fixture_candidate(candidate, DESKTOP_VERSION)
            .expect_err("stable Desktop must match Core exactly");

        assert!(error.contains("Stable Desktop/Core version mismatch"));
        assert!(error.contains("Desktop is 4.27.4, Core is 4.27.3"));
    }

    #[test]
    fn backend_manifest_paths_cannot_escape_the_selected_bundle() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");

        let parent_candidate = create_bundle_candidate(
            &temp_dir,
            "parent-path",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        fs::write(
            parent_candidate
                .backend_dir
                .parent()
                .expect("resource root")
                .join("outside-python"),
            b"outside",
        )
        .expect("write outside fixture");
        set_manifest_field(&parent_candidate, "python", "../outside-python");
        let parent_error = validate_fixture_candidate(parent_candidate, DESKTOP_VERSION)
            .expect_err("parent traversal must fail");
        assert!(parent_error.contains("python must be a canonical relative path"));

        let absolute_candidate = create_bundle_candidate(
            &temp_dir,
            "absolute-path",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        let absolute_entrypoint = temp_dir.path().join("outside-launch.py");
        fs::write(&absolute_entrypoint, b"print('outside')\n")
            .expect("write absolute outside fixture");
        set_manifest_field(
            &absolute_candidate,
            "entrypoint",
            &absolute_entrypoint.to_string_lossy(),
        );
        let absolute_error = validate_fixture_candidate(absolute_candidate, DESKTOP_VERSION)
            .expect_err("absolute path must fail");
        assert!(absolute_error.contains("entrypoint must be a canonical relative path"));
    }

    #[cfg(unix)]
    #[test]
    fn backend_manifest_symlink_cannot_escape_the_selected_bundle() {
        use std::os::unix::fs::symlink;

        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let candidate = create_bundle_candidate(
            &temp_dir,
            "symlink-path",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        let outside_entrypoint = temp_dir.path().join("outside-launch.py");
        fs::write(&outside_entrypoint, b"print('outside')\n").expect("write outside fixture");
        let symlink_path = candidate.backend_dir.join("linked-launch.py");
        symlink(&outside_entrypoint, &symlink_path).expect("create escape symlink");
        set_manifest_field(&candidate, "entrypoint", "linked-launch.py");

        let error = validate_fixture_candidate(candidate, DESKTOP_VERSION)
            .expect_err("symlink escape must fail");

        assert!(error.contains("entrypoint escapes packaged resource directory"));
    }

    #[test]
    fn webui_content_must_match_the_attested_digests() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        let candidate = create_bundle_candidate(
            &temp_dir,
            "direct",
            "direct",
            DESKTOP_VERSION,
            CORE_VERSION,
            "v4.27.4",
        );
        fs::write(
            candidate.webui_dir.join("assets").join("index-test.js"),
            b"export const stale = true;\n",
        )
        .expect("tamper WebUI entry fixture");

        let error = validate_fixture_candidate(candidate, DESKTOP_VERSION)
            .expect_err("tampered WebUI entry must fail");

        assert!(error.contains("WebUI entry asset digest mismatch"));
    }

    #[test]
    fn nightly_and_custom_desktops_accept_matching_older_core_and_webui_versions() {
        let temp_dir = tempfile::tempdir().expect("create temp dir");
        for (directory_name, desktop_version) in [
            ("nightly", "4.27.5-nightly.20260901.abcdef12"),
            ("custom", "4.27.5-custom.abcdef12"),
        ] {
            let candidate = create_bundle_candidate(
                &temp_dir,
                directory_name,
                "direct",
                desktop_version,
                CORE_VERSION,
                "v4.27.4",
            );

            let selected = validate_fixture_candidate(candidate, desktop_version)
                .expect("derived Desktop may package a different Core version");

            assert_eq!(selected.label, "direct");
            assert_eq!(
                packaged_webui_cache_version(&selected.runtime_manifest_sha256),
                format!("v1-{}", selected.runtime_manifest_sha256)
            );
        }
    }

    #[test]
    fn resolve_custom_launch_sets_startup_heartbeat_path_from_root_dir() {
        let _root_guard = EnvVarGuard::set(crate::ASTRBOT_ROOT_ENV, "/tmp/astrbot-root");

        let plan = resolve_custom_launch("python main.py".to_string()).expect("custom plan");

        assert_eq!(
            plan.startup_heartbeat_path,
            Some(PathBuf::from("/tmp/astrbot-root").join("data/backend-startup-heartbeat.json"))
        );
    }
}

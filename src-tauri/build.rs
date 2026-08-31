use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    env, fs,
    path::{Component, Path},
};

const TAURI_CONFIG_PATH: &str = "tauri.conf.json";
const BACKEND_RESOURCE_SOURCE: &str = "../resources/backend";
const WEBUI_RESOURCE_SOURCE: &str = "../resources/webui";
const RUNTIME_MANIFEST_RELATIVE_PATH: &str = "../resources/backend/runtime-manifest.json";
const DEVELOPMENT_UNBOUND_MANIFEST: &str = "development-unbound";

fn load_bundle_resource_alias(tauri_config: &Value, source_relative_path: &str) -> String {
    // Keep validation rules aligned with
    // scripts/ci/package_windows_portable.py::resolve_bundle_resource_alias_from_tauri_config.
    let bundle = tauri_config
        .get("bundle")
        .and_then(Value::as_object)
        .unwrap_or_else(|| panic!("missing bundle object in {TAURI_CONFIG_PATH}"));
    let resources = bundle
        .get("resources")
        .and_then(Value::as_object)
        .unwrap_or_else(|| panic!("missing bundle.resources object in {TAURI_CONFIG_PATH}"));

    let alias_value = resources.get(source_relative_path).unwrap_or_else(|| {
        panic!(
            "missing bundle.resources alias for {} in {}",
            source_relative_path, TAURI_CONFIG_PATH
        )
    });
    let alias = alias_value.as_str().map(str::trim).unwrap_or_else(|| {
        panic!(
            "bundle.resources alias for {} must be a string in {}",
            source_relative_path, TAURI_CONFIG_PATH
        )
    });
    assert!(
        !alias.is_empty(),
        "bundle.resources alias for {} is empty in {}",
        source_relative_path,
        TAURI_CONFIG_PATH
    );

    let alias_path = Path::new(alias);
    assert!(
        !alias_path.is_absolute()
            && alias_path.components().all(|component| {
                !matches!(
                    component,
                    Component::CurDir
                        | Component::ParentDir
                        | Component::Prefix(_)
                        | Component::RootDir
                )
            }),
        "bundle.resources alias for {} must be a relative path without traversal in {}: {}",
        source_relative_path,
        TAURI_CONFIG_PATH,
        alias
    );

    alias.to_string()
}

fn runtime_manifest_sha256() -> String {
    let manifest_dir = env::var_os("CARGO_MANIFEST_DIR")
        .expect("Cargo did not provide CARGO_MANIFEST_DIR to build.rs");
    let manifest_path = Path::new(&manifest_dir).join(RUNTIME_MANIFEST_RELATIVE_PATH);
    println!("cargo:rerun-if-changed={}", manifest_path.display());
    match fs::read(&manifest_path) {
        Ok(bytes) if !bytes.is_empty() => format!("{:x}", Sha256::digest(bytes)),
        Ok(_) => panic!(
            "packaged runtime manifest is empty: {}",
            manifest_path.display()
        ),
        Err(error) if env::var("PROFILE").as_deref() != Ok("release") => {
            println!(
                "cargo:warning=packaged runtime manifest is unavailable in a development build: {} ({error})",
                manifest_path.display()
            );
            DEVELOPMENT_UNBOUND_MANIFEST.to_string()
        }
        Err(error) => panic!(
            "failed to read packaged runtime manifest {} before release compilation: {error}",
            manifest_path.display()
        ),
    }
}

fn main() {
    let marker_path = Path::new("windows").join("portable-runtime-marker.txt");
    let tauri_config_path = Path::new(TAURI_CONFIG_PATH);
    println!("cargo:rerun-if-changed={}", marker_path.display());
    println!("cargo:rerun-if-changed={}", tauri_config_path.display());

    let marker = fs::read_to_string(&marker_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", marker_path.display()));
    let marker = marker.trim();
    assert!(
        !marker.is_empty(),
        "portable runtime marker file is empty: {}",
        marker_path.display()
    );
    println!("cargo:rustc-env=ASTRBOT_PORTABLE_RUNTIME_MARKER={marker}");

    let tauri_config_text = fs::read_to_string(tauri_config_path)
        .unwrap_or_else(|error| panic!("failed to read {}: {error}", tauri_config_path.display()));
    let tauri_config: Value = serde_json::from_str(&tauri_config_text)
        .unwrap_or_else(|error| panic!("failed to parse {}: {error}", tauri_config_path.display()));

    let backend_resource_alias = load_bundle_resource_alias(&tauri_config, BACKEND_RESOURCE_SOURCE);
    let webui_resource_alias = load_bundle_resource_alias(&tauri_config, WEBUI_RESOURCE_SOURCE);
    println!("cargo:rustc-env=ASTRBOT_BACKEND_RESOURCE_ALIAS={backend_resource_alias}");
    println!("cargo:rustc-env=ASTRBOT_WEBUI_RESOURCE_ALIAS={webui_resource_alias}");
    println!(
        "cargo:rustc-env=ASTRBOT_RUNTIME_MANIFEST_SHA256={}",
        runtime_manifest_sha256()
    );

    tauri_build::build()
}

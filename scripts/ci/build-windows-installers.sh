#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/../.." && pwd)"

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required to build Windows installers." >&2
  exit 1
fi

if ! (
  cd "${root_dir}"
  cargo tauri -V >/dev/null 2>&1
); then
  echo "Tauri CLI is required to build Windows installers (expected: cargo tauri)." >&2
  exit 1
fi

bundles="${ASTRBOT_WINDOWS_BUNDLES:-nsis}"
if [ -z "${bundles}" ]; then
  echo "ASTRBOT_WINDOWS_BUNDLES is empty. Expected a comma-separated bundle list." >&2
  exit 1
fi

tauri_config_path="${ASTRBOT_TAURI_CONFIG_PATH:-}"
tauri_build_args=(--bundles "${bundles}")
if [ -n "${tauri_config_path}" ]; then
  tauri_build_args=(--config "${tauri_config_path}" "${tauri_build_args[@]}")
fi

echo "Building Windows installers with bundles: ${bundles}"
(
  cd "${root_dir}"
  cargo tauri build "${tauri_build_args[@]}"
)

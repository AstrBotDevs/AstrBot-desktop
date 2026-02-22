#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/../.." && pwd)"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required to build Windows installers." >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "cargo is required to build Windows installers." >&2
  exit 1
fi

bundles="${ASTRBOT_WINDOWS_BUNDLES:-nsis,nsis-web}"
if [ -z "${bundles}" ]; then
  echo "ASTRBOT_WINDOWS_BUNDLES is empty. Expected a comma-separated bundle list." >&2
  exit 1
fi

echo "Building Windows installers with bundles: ${bundles}"
(
  cd "${root_dir}"
  cargo tauri build --bundles "${bundles}"
)

#!/usr/bin/env bash

set -euo pipefail

if [ "${#}" -ne 1 ]; then
  echo "Usage: $0 <expected-astrbot-version>" >&2
  exit 2
fi

raw_expected="$1"
expected="$(
  printf '%s' "${raw_expected}" \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^[vV]+//'
)"

if [ -z "${expected}" ]; then
  echo "Invalid expected version input: '${raw_expected}'" >&2
  exit 1
fi

pkg_version="$(node -e "console.log(require('./package.json').version)")"
tauri_version="$(node -e "console.log(require('./src-tauri/tauri.conf.json').version)")"
cargo_version="$(
  node -e "const fs=require('fs');const content=fs.readFileSync('src-tauri/Cargo.toml','utf8');const match=content.match(/\\[package\\][\\s\\S]*?\\nversion\\s*=\\s*\\\"([^\\\"]+)\\\"/m);console.log(match?match[1]:'');"
)"

if [ -z "${cargo_version}" ]; then
  echo "Failed to resolve package.version from src-tauri/Cargo.toml" >&2
  exit 1
fi

if [ "${pkg_version}" != "${expected}" ] || [ "${tauri_version}" != "${expected}" ] || [ "${cargo_version}" != "${expected}" ]; then
  echo "Version sync mismatch: expected=${expected}, package.json=${pkg_version}, tauri.conf.json=${tauri_version}, Cargo.toml=${cargo_version}" >&2
  exit 1
fi

echo "Version sync verified: ${expected}"

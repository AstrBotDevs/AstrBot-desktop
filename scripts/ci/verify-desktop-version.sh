#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib/version-utils.sh
. "${script_dir}/lib/version-utils.sh"

if [ "${#}" -ne 1 ]; then
  echo "Usage: $0 <expected-astrbot-version>" >&2
  exit 2
fi

raw_expected="$1"
expected="$(normalize_version "${raw_expected}")"

if [ -z "${expected}" ]; then
  echo "Invalid expected version input: '${raw_expected}'" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to parse tauri.conf.json and Cargo.toml" >&2
  exit 1
fi

pkg_version="$(node -e "console.log(require('./package.json').version)")"
tauri_and_cargo_versions="$(
  python3 - <<'PY'
import json
import pathlib
import sys

try:
    import tomllib as toml_parser
except ModuleNotFoundError:
    try:
        import tomli as toml_parser
    except ModuleNotFoundError:
        print(
            "A TOML parser is required: Python 3.11+ (tomllib) or tomli package.",
            file=sys.stderr,
        )
        raise SystemExit(1)

root = pathlib.Path(".")
tauri_conf_path = root / "src-tauri" / "tauri.conf.json"
cargo_toml_path = root / "src-tauri" / "Cargo.toml"

try:
    tauri_conf = json.loads(tauri_conf_path.read_text(encoding="utf-8"))
except Exception as error:
    print(f"Failed to parse {tauri_conf_path}: {error}", file=sys.stderr)
    raise SystemExit(1)

try:
    cargo_manifest = toml_parser.loads(cargo_toml_path.read_text(encoding="utf-8"))
except Exception as error:
    print(f"Failed to parse {cargo_toml_path}: {error}", file=sys.stderr)
    raise SystemExit(1)

tauri_version = tauri_conf.get("version", "")
if not isinstance(tauri_version, str):
    tauri_version = ""

package_section = cargo_manifest.get("package", {})
if not isinstance(package_section, dict):
    package_section = {}
cargo_version = package_section.get("version", "")
if not isinstance(cargo_version, str):
    cargo_version = ""

print(f"{tauri_version}\t{cargo_version}")
PY
)"
IFS=$'\t' read -r tauri_version cargo_version <<< "${tauri_and_cargo_versions}"

if [ -z "${cargo_version}" ]; then
  echo "Failed to resolve package.version from src-tauri/Cargo.toml" >&2
  exit 1
fi

if [ "${pkg_version}" != "${expected}" ] || [ "${tauri_version}" != "${expected}" ] || [ "${cargo_version}" != "${expected}" ]; then
  echo "Version sync mismatch: expected=${expected}, package.json=${pkg_version}, tauri.conf.json=${tauri_version}, Cargo.toml=${cargo_version}" >&2
  exit 1
fi

echo "Version sync verified: ${expected}"

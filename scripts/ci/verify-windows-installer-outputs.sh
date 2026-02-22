#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root_dir="$(cd "${script_dir}/../.." && pwd)"

if [ -z "${WINDOWS_INSTALLER_EXE_GLOBS:-}" ]; then
  echo "WINDOWS_INSTALLER_EXE_GLOBS is required." >&2
  exit 1
fi

shopt -s nullglob
missing_patterns=0

(
  cd "${root_dir}"

  while IFS= read -r raw_pattern; do
    pattern="$(printf '%s' "${raw_pattern}" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
    [ -n "${pattern}" ] || continue

    matches=( ${pattern} )
    if [ "${#matches[@]}" -eq 0 ]; then
      echo "Missing Windows installer output for pattern: ${pattern}" >&2
      missing_patterns=1
      continue
    fi

    echo "Detected Windows installers for pattern ${pattern}:"
    printf '  %s\n' "${matches[@]}"
  done <<< "${WINDOWS_INSTALLER_EXE_GLOBS}"

  if [ "${missing_patterns}" -ne 0 ]; then
    exit 1
  fi
)

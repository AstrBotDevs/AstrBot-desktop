#!/usr/bin/env bash
set -euo pipefail

if [ -z "${APPLE_SIGNING_IDENTITY:-}" ]; then
  echo "::warning::APPLE_SIGNING_IDENTITY is not set; skipping nested code signing."
  exit 0
fi

APP_BUNDLE="${1:?Usage: $0 <path-to-app-bundle>}"
if [ ! -d "${APP_BUNDLE}" ]; then
  echo "::error::App bundle not found: ${APP_BUNDLE}" >&2
  exit 1
fi

ENTITLEMENTS_PATH="${2:-}"
ENTITLEMENTS_ARGS=()
if [ -n "${ENTITLEMENTS_PATH}" ] && [ -f "${ENTITLEMENTS_PATH}" ]; then
  ENTITLEMENTS_ARGS=(--entitlements "${ENTITLEMENTS_PATH}")
fi

echo "Signing nested binaries inside ${APP_BUNDLE} with identity: ${APPLE_SIGNING_IDENTITY}"

NESTED_BINARIES=()
while IFS= read -r -d '' file; do
  if file --brief "${file}" | grep -q "Mach-O"; then
    NESTED_BINARIES+=("${file}")
  fi
done < <(find "${APP_BUNDLE}/Contents/Resources" -type f -print0 2>/dev/null || true)

if [ "${#NESTED_BINARIES[@]}" -eq 0 ]; then
  echo "No nested Mach-O binaries found in Resources; nothing extra to sign."
  exit 0
fi

echo "Found ${#NESTED_BINARIES[@]} nested Mach-O binary(ies) to sign."

for binary in "${NESTED_BINARIES[@]}"; do
  echo "  Signing: ${binary}"
  codesign --force --options runtime \
    "${ENTITLEMENTS_ARGS[@]+"${ENTITLEMENTS_ARGS[@]}"}" \
    --sign "${APPLE_SIGNING_IDENTITY}" \
    "${binary}"
done

echo "Re-signing the app bundle itself..."
codesign --force --options runtime \
  "${ENTITLEMENTS_ARGS[@]+"${ENTITLEMENTS_ARGS[@]}"}" \
  --sign "${APPLE_SIGNING_IDENTITY}" \
  --deep \
  "${APP_BUNDLE}"

echo "Verifying signature..."
codesign --verify --verbose=2 --deep --strict "${APP_BUNDLE}"

echo "Nested code signing completed successfully."

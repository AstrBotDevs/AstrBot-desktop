#!/usr/bin/env bash

set -euo pipefail

if [ "${#}" -ne 1 ]; then
  echo "Usage: $0 <astrbot-version>" >&2
  exit 2
fi

raw_version="$1"
normalized_version="$(
  printf '%s' "${raw_version}" \
    | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//; s/^[vV]+//'
)"

if [ -z "${normalized_version}" ]; then
  echo "Invalid AstrBot version input: '${raw_version}'" >&2
  exit 1
fi

export ASTRBOT_DESKTOP_VERSION="v${normalized_version}"
echo "Syncing desktop version with ASTRBOT_DESKTOP_VERSION=${ASTRBOT_DESKTOP_VERSION}"
pnpm run sync:version

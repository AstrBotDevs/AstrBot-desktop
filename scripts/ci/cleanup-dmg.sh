#!/usr/bin/env bash

set -uo pipefail

detach_attempts="${ASTRBOT_DESKTOP_MACOS_DETACH_ATTEMPTS:-3}"
detach_sleep_seconds="${ASTRBOT_DESKTOP_MACOS_DETACH_SLEEP_SECONDS:-2}"
rw_dmg_image_prefix="${ASTRBOT_DESKTOP_MACOS_RW_DMG_IMAGE_PREFIX:-/src-tauri/target/}"
rw_dmg_image_suffix_regex="${ASTRBOT_DESKTOP_MACOS_RW_DMG_IMAGE_SUFFIX_REGEX:-/bundle/macos/rw\\..*\\.dmg$}"
rw_dmg_mountpoint_regex="${ASTRBOT_DESKTOP_MACOS_RW_DMG_MOUNT_REGEX:-^/Volumes/(dmg\\.|rw\\.|dmg-|rw-).*}"
allow_global_helper_cleanup="${ASTRBOT_DESKTOP_MACOS_ALLOW_GLOBAL_HELPER_KILL:-0}"
workspace_root="${ASTRBOT_DESKTOP_MACOS_WORKSPACE_ROOT:-${GITHUB_WORKSPACE:-$(pwd)}}"
workspace_root="${workspace_root%/}"

declare -a canonical_path_cache_keys=()
declare -a canonical_path_cache_values=()
canonicalize_tool="none"
canonicalize_warned_failure=0

if command -v realpath >/dev/null 2>&1; then
  canonicalize_tool="realpath"
elif command -v readlink >/dev/null 2>&1 && readlink -f / >/dev/null 2>&1; then
  canonicalize_tool="readlink"
elif command -v python3 >/dev/null 2>&1; then
  canonicalize_tool="python3"
else
  echo "WARN: no realpath/readlink/python3 available; path canonicalization disabled" >&2
fi

detach_target() {
  local target="$1"
  local pass=1
  while [ "${pass}" -le "${detach_attempts}" ]; do
    if hdiutil detach "${target}" >/dev/null 2>&1; then
      return 0
    fi
    hdiutil detach -force "${target}" >/dev/null 2>&1 || true
    sleep "${detach_sleep_seconds}"
    pass=$((pass + 1))
  done
  echo "WARN: Failed to detach ${target} after ${detach_attempts} attempts" >&2
  return 1
}

canonicalize_path() {
  local raw_path="$1"
  local idx
  for idx in "${!canonical_path_cache_keys[@]}"; do
    if [ "${canonical_path_cache_keys[$idx]}" = "${raw_path}" ]; then
      printf '%s\n' "${canonical_path_cache_values[$idx]}"
      return 0
    fi
  done

  local resolved_path
  case "${canonicalize_tool}" in
    realpath)
      resolved_path="$(realpath "${raw_path}" 2>/dev/null)" || resolved_path=""
      ;;
    readlink)
      resolved_path="$(readlink -f "${raw_path}" 2>/dev/null)" || resolved_path=""
      ;;
    python3)
      resolved_path="$(
        python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "${raw_path}" 2>/dev/null
      )" || resolved_path=""
      ;;
    *)
      resolved_path="${raw_path}"
      ;;
  esac
  if [ -z "${resolved_path}" ]; then
    resolved_path="${raw_path}"
    if [ "${canonicalize_warned_failure}" = "0" ]; then
      echo "WARN: failed to canonicalize path via ${canonicalize_tool}; using raw paths" >&2
      canonicalize_warned_failure=1
    fi
  fi
  canonical_path_cache_keys+=("${raw_path}")
  canonical_path_cache_values+=("${resolved_path}")
  printf '%s\n' "${resolved_path}"
}

workspace_root_canonical="$(canonicalize_path "${workspace_root}")"
workspace_root_canonical="${workspace_root_canonical%/}"

is_workspace_rw_dmg_image() {
  local image="$1"
  local normalized_image
  normalized_image="$(canonicalize_path "${image}")"
  local candidate
  for candidate in "${image}" "${normalized_image}"; do
    candidate="${candidate%/}"
    if [[ "${candidate}" == "${workspace_root}${rw_dmg_image_prefix}"* ]] &&
       [[ "${candidate}" =~ ${rw_dmg_image_suffix_regex} ]]; then
      return 0
    fi
    if [[ -n "${workspace_root_canonical}" ]] &&
       [[ "${candidate}" == "${workspace_root_canonical}${rw_dmg_image_prefix}"* ]] &&
       [[ "${candidate}" =~ ${rw_dmg_image_suffix_regex} ]]; then
      return 0
    fi
  done
  return 1
}

collect_dmg_records() {
  if ! command -v hdiutil >/dev/null 2>&1; then
    echo "WARN: hdiutil is unavailable; skip DMG record inspection." >&2
    return 0
  fi
  hdiutil info 2>/dev/null | awk '
    BEGIN { image = ""; dev = ""; pid = "" }
    /^image-path[[:space:]]*:/ {
      line = $0
      sub(/^image-path[[:space:]]*:[[:space:]]*/, "", line)
      image = line
      next
    }
    /^\/dev\/disk[0-9]+/ && dev == "" {
      dev = $1
      next
    }
    /^process ID[[:space:]]*:/ {
      line = $0
      sub(/^process ID[[:space:]]*:[[:space:]]*/, "", line)
      pid = line
      next
    }
    /^=+/ {
      if (image != "") {
        print image "\t" dev "\t" pid
      }
      image = ""
      dev = ""
      pid = ""
      next
    }
    END {
      if (image != "") {
        print image "\t" dev "\t" pid
      }
    }
  ' || true
}

terminate_pid_soft_then_hard() {
  local pid="$1"
  kill -TERM "${pid}" 2>/dev/null || return 0
  sleep 1
  if kill -0 "${pid}" 2>/dev/null; then
    kill -KILL "${pid}" 2>/dev/null || true
  fi
}

cleanup_stale_dmg_state() {
  local dmg_mounts
  dmg_mounts="$(mount | awk -v mount_regex="${rw_dmg_mountpoint_regex}" '
    $1 ~ /^\/dev\/disk/ && $3 ~ mount_regex { print $3 }
  ' || true)"
  if [ -n "${dmg_mounts}" ]; then
    while IFS= read -r mount_point; do
      [ -z "${mount_point}" ] && continue
      echo "Detaching stale mount ${mount_point}"
      detach_target "${mount_point}" || true
    done <<< "${dmg_mounts}"
  fi

  local dmg_records
  dmg_records="$(collect_dmg_records)"
  if [ -z "${dmg_records}" ]; then
    return 0
  fi

  local workspace_disks=""
  local workspace_helper_pids=""
  while IFS=$'\t' read -r image disk pid; do
    [ -z "${image:-}" ] && continue
    if ! is_workspace_rw_dmg_image "${image}"; then
      continue
    fi
    if [[ "${disk}" =~ ^/dev/disk[0-9]+$ ]]; then
      workspace_disks+="${disk}"$'\n'
    fi
    if [[ "${pid}" =~ ^[0-9]+$ ]]; then
      workspace_helper_pids+="${pid}"$'\n'
    fi
  done <<< "${dmg_records}"

  workspace_disks="$(printf '%s\n' "${workspace_disks}" | awk 'NF' | sort -u)"
  workspace_helper_pids="$(printf '%s\n' "${workspace_helper_pids}" | awk 'NF' | sort -u)"

  if [ -n "${workspace_disks}" ]; then
    while IFS= read -r disk; do
      [ -z "${disk}" ] && continue
      echo "Detaching stale disk ${disk}"
      detach_target "${disk}" || true
    done <<< "${workspace_disks}"
  fi

  local helper_pids
  helper_pids="${workspace_helper_pids}"

  if [ -z "${helper_pids}" ] && [ "${allow_global_helper_cleanup}" = "1" ]; then
    helper_pids="$(
      pgrep -x diskimages-helper || true
      pgrep -x diskimages-help || true
    )"
  elif [ -z "${helper_pids}" ]; then
    echo "Skip global disk image helper cleanup (set ASTRBOT_DESKTOP_MACOS_ALLOW_GLOBAL_HELPER_KILL=1 to enable)." >&2
  fi
  helper_pids="$(printf '%s\n' "${helper_pids}" | awk 'NF' | sort -u)"
  if [ -n "${helper_pids}" ]; then
    while IFS= read -r pid; do
      [ -z "${pid}" ] && continue
      echo "Killing stale disk image helper pid=${pid}"
      terminate_pid_soft_then_hard "${pid}"
    done <<< "${helper_pids}"
  fi
}

cleanup_stale_dmg_state || true
exit 0

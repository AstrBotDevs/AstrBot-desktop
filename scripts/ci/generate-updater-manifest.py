#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import pathlib
import re
from datetime import datetime, timezone

UPDATER_ARTIFACT_PATTERN = re.compile(
    r"^AstrBot_(?P<version>.+)_(?P<os>linux|macos|windows)_(?P<arch>[A-Za-z0-9_]+)_updater\.(?P<ext>tar\.gz|zip)$"
)

ARCH_TO_TAURI_TARGET = {
    "amd64": "x86_64",
    "x86_64": "x86_64",
    "arm64": "aarch64",
    "aarch64": "aarch64",
}

OS_TO_TAURI_TARGET = {
    "linux": "linux",
    "macos": "darwin",
    "windows": "windows",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate Tauri updater latest.json from normalized updater assets."
    )
    parser.add_argument("--root", required=True, help="Directory containing release assets.")
    parser.add_argument(
        "--repository",
        required=True,
        help="GitHub repository in owner/name form (for download URLs).",
    )
    parser.add_argument("--release-tag", required=True, help="Release tag name.")
    parser.add_argument(
        "--version",
        required=True,
        help="Updater manifest version (SemVer or v-prefixed SemVer).",
    )
    parser.add_argument("--output", required=True, help="Output latest.json path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = pathlib.Path(args.root)
    output_path = pathlib.Path(args.output)
    if not root.exists():
        print(f"[updater-manifest] assets directory does not exist: {root}")
        return 0

    platforms: dict[str, dict[str, str]] = {}
    asset_base_url = (
        f"https://github.com/{args.repository}/releases/download/{args.release_tag}"
    )

    for asset_path in sorted(path for path in root.rglob("*") if path.is_file()):
        match = UPDATER_ARTIFACT_PATTERN.fullmatch(asset_path.name)
        if not match:
            continue

        groups = match.groupdict()
        os_name = groups["os"]
        arch_name = groups["arch"]

        tauri_os = OS_TO_TAURI_TARGET.get(os_name)
        tauri_arch = ARCH_TO_TAURI_TARGET.get(arch_name)
        if tauri_os is None or tauri_arch is None:
            print(
                f"::warning::[updater-manifest] unsupported updater artifact target: {asset_path.name}"
            )
            continue

        signature_path = asset_path.with_name(f"{asset_path.name}.sig")
        if not signature_path.exists():
            print(
                f"::warning::[updater-manifest] missing signature for updater artifact: {asset_path.name}"
            )
            continue

        signature = signature_path.read_text(encoding="utf-8").strip()
        if not signature:
            print(
                f"::warning::[updater-manifest] empty signature for updater artifact: {signature_path.name}"
            )
            continue

        platform_key = f"{tauri_os}-{tauri_arch}"
        if platform_key in platforms:
            print(
                f"::warning::[updater-manifest] duplicate updater artifact for {platform_key}, keeping first one"
            )
            continue

        platforms[platform_key] = {
            "signature": signature,
            "url": f"{asset_base_url}/{asset_path.name}",
        }

    if not platforms:
        print("[updater-manifest] no updater assets found; skip latest.json generation")
        return 0

    manifest = {
        "version": args.version,
        "pub_date": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "platforms": platforms,
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[updater-manifest] generated: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

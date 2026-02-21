#!/usr/bin/env python3
"""Resolve macOS .app bundle name for CI packaging."""

from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path
from typing import Any


def get_nested(data: dict[str, Any], keys: tuple[str, ...]) -> Any:
    current: Any = data
    for key in keys:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def normalize_bundle_name(name: str) -> str:
    normalized = name.strip()
    if normalized.lower().endswith(".app"):
        normalized = normalized[:-4]
    return normalized.strip()


def write_github_output(path: Path, key: str, value: str) -> None:
    marker = f"EOF_{uuid.uuid4().hex}"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(f"{key}<<{marker}\n{value}\n{marker}\n")


def resolve_from_config(config_path: Path) -> tuple[str, str]:
    if not config_path.is_file():
        raise RuntimeError(
            f"Required file not found: {config_path} "
            "(or set ASTRBOT_MACOS_APP_BUNDLE_NAME)."
        )

    try:
        data = json.loads(config_path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover
        raise RuntimeError(f"Failed to parse JSON from {config_path}: {exc}") from exc

    candidates: list[tuple[tuple[str, ...], str]] = [
        (("productName",), "productName"),
        (("bundle", "productName"), "bundle.productName"),
        (("tauri", "productName"), "tauri.productName"),
        (("tauri", "bundle", "productName"), "tauri.bundle.productName"),
        (("package", "productName"), "package.productName"),
    ]
    for keys, path_label in candidates:
        value = get_nested(data, keys)
        if isinstance(value, str) and value.strip():
            return value, f"tauri.conf.json {path_label}"

    expected = ", ".join(path for _, path in candidates)
    raise RuntimeError(
        f"Unable to resolve app bundle name from {config_path}. "
        f"Expected one of: {expected}."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Path to tauri.conf.json")
    parser.add_argument(
        "--override-name",
        default="",
        help="Explicit bundle name override (e.g. from env var)",
    )
    parser.add_argument(
        "--override-source",
        default="env:ASTRBOT_MACOS_APP_BUNDLE_NAME",
        help="Source label used when override-name is provided",
    )
    parser.add_argument(
        "--github-output",
        default="",
        help="Path to GITHUB_OUTPUT file for step outputs",
    )
    args = parser.parse_args()

    if args.override_name.strip():
        raw_name = args.override_name
        source = args.override_source
    else:
        raw_name, source = resolve_from_config(Path(args.config))

    app_bundle_name = normalize_bundle_name(raw_name)
    if not app_bundle_name:
        raise RuntimeError(
            "Resolved app bundle name is empty after normalization "
            f"(original value: {raw_name!r} from {source}; "
            "possible value was only '.app')."
        )

    print(f"Resolved app bundle name: {app_bundle_name} (source={source})")

    if args.github_output:
        output_path = Path(args.github_output)
        write_github_output(output_path, "app_bundle_name", app_bundle_name)
        write_github_output(output_path, "app_bundle_name_source", source)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)

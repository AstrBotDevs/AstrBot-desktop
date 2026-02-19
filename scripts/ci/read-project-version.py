#!/usr/bin/env python3

from __future__ import annotations

import pathlib
import sys


def _load_toml_module():
    try:
        import tomllib

        return tomllib
    except ModuleNotFoundError:
        import tomli

        return tomli


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: read-project-version.py <pyproject.toml>", file=sys.stderr)
        return 2

    pyproject_path = pathlib.Path(sys.argv[1])
    if not pyproject_path.is_file():
        print(f"File not found: {pyproject_path}", file=sys.stderr)
        return 2

    try:
        pyproject_text = pyproject_path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"Failed to read {pyproject_path}: {exc}", file=sys.stderr)
        return 1

    toml_module = _load_toml_module()
    try:
        data = toml_module.loads(pyproject_text)
    except Exception as exc:
        print(f"Failed to parse {pyproject_path}: {exc}", file=sys.stderr)
        return 1
    version = data.get("project", {}).get("version")
    if not isinstance(version, str) or not version.strip():
        print("Unable to resolve project.version from pyproject.toml", file=sys.stderr)
        return 1

    print(version.strip())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

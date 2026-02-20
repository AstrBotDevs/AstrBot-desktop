#!/usr/bin/env python3

from __future__ import annotations

import pathlib
import sys
from collections import defaultdict


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: validate-release-artifacts.py <release-artifacts-dir>", file=sys.stderr)
        return 2

    root = pathlib.Path(sys.argv[1])
    if not root.exists():
        print(f"Artifacts directory not found: {root}", file=sys.stderr)
        return 1
    if not root.is_dir():
        print(f"Artifacts path is not a directory: {root}", file=sys.stderr)
        return 1

    by_name: dict[str, list[pathlib.Path]] = defaultdict(list)
    for path in root.rglob("*"):
        if path.is_file():
            by_name[path.name].append(path)

    duplicates = {name: paths for name, paths in by_name.items() if len(paths) > 1}
    if duplicates:
        print("Duplicate artifact filenames detected after merge:", file=sys.stderr)
        for name, paths in sorted(duplicates.items()):
            print(f"- {name}", file=sys.stderr)
            for path in sorted(paths):
                print(f"  - {path}", file=sys.stderr)
        return 1

    print("No duplicate artifact filenames detected.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

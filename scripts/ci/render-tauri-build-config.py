#!/usr/bin/env python3

from __future__ import annotations

import argparse
import json
import pathlib

DEFAULT_UPDATER_ENDPOINT = (
    "https://github.com/AstrBotDevs/AstrBot-desktop/releases/latest/download/latest.json"
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render a temporary Tauri config override for CI/local builds."
    )
    parser.add_argument("--output", required=True, help="Path to output JSON config file.")
    parser.add_argument(
        "--updater-endpoint",
        default=DEFAULT_UPDATER_ENDPOINT,
        help="Updater latest.json endpoint URL.",
    )
    parser.add_argument(
        "--updater-pubkey",
        default="",
        help="Updater public key. If empty, plugins.updater override is skipped.",
    )
    parser.add_argument(
        "--disable-updater-artifacts",
        action="store_true",
        help="Disable bundle.createUpdaterArtifacts override.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output_path = pathlib.Path(args.output)
    updater_endpoint = args.updater_endpoint.strip()
    updater_pubkey = args.updater_pubkey.strip()

    config: dict[str, object] = {}
    if not args.disable_updater_artifacts:
        config["bundle"] = {"createUpdaterArtifacts": True}

    if updater_endpoint and updater_pubkey:
        config["plugins"] = {
            "updater": {
                "active": True,
                "endpoints": [updater_endpoint],
                "pubkey": updater_pubkey,
            }
        }
    elif updater_endpoint and not updater_pubkey:
        print(
            "::warning::[tauri-build-config] "
            "ASTRBOT_UPDATER_PUBKEY is empty; skip plugins.updater override."
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(config, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"[tauri-build-config] generated: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

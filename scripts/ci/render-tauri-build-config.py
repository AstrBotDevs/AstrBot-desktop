#!/usr/bin/env python3

from __future__ import annotations

import argparse
import base64
import json
import pathlib
import re

DEFAULT_UPDATER_ENDPOINT = (
    "https://github.com/AstrBotDevs/AstrBot-desktop/releases/latest/download/latest.json"
)
MINISIGN_COMMENT_PREFIX = "untrusted comment:"
DEFAULT_MINISIGN_PUBKEY_COMMENT = "untrusted comment: minisign public key"
BASE64_RE = re.compile(r"^[A-Za-z0-9+/=]+$")


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


def _is_base64_blob(value: str) -> bool:
    if not value or not BASE64_RE.match(value):
        return False
    try:
        base64.b64decode(value, validate=True)
    except Exception:
        return False
    return True


def _extract_pubkey_parts_from_text(value: str, *, field_name: str) -> tuple[str, str]:
    lines = [line.strip() for line in value.splitlines() if line.strip()]
    if not lines:
        raise ValueError(f"{field_name} is empty after normalization.")

    comment = DEFAULT_MINISIGN_PUBKEY_COMMENT
    if lines[0].lower().startswith(MINISIGN_COMMENT_PREFIX):
        comment = lines[0]
        if len(lines) < 2:
            raise ValueError(
                f"{field_name} minisign text is missing public key line after comment."
            )
        key_line = "".join(lines[1].split())
    elif len(lines) == 1:
        key_line = "".join(lines[0].split())
    else:
        key_line = "".join(lines[-1].split())

    if not _is_base64_blob(key_line):
        raise ValueError(
            f"{field_name} normalized public key line is not valid base64 key material."
        )
    return comment, key_line


def _encode_pubkey_text(comment: str, key_line: str) -> str:
    normalized_comment = comment.strip() or DEFAULT_MINISIGN_PUBKEY_COMMENT
    normalized_key_line = "".join(key_line.split())
    key_text = f"{normalized_comment}\n{normalized_key_line}\n"
    return base64.b64encode(key_text.encode("utf-8")).decode("ascii")


def normalize_updater_pubkey(raw: str, *, field_name: str) -> str:
    value = raw.strip()
    if not value:
        return ""

    if value.lstrip().startswith(MINISIGN_COMMENT_PREFIX) or "\n" in value:
        comment, key_line = _extract_pubkey_parts_from_text(value, field_name=field_name)
        return _encode_pubkey_text(comment, key_line)

    direct = "".join(value.split())
    if not _is_base64_blob(direct):
        raise ValueError(
            f"{field_name} is not valid updater pubkey input: expected minisign text or base64 key."
        )

    try:
        decoded_bytes = base64.b64decode(direct, validate=True)
    except Exception as error:
        raise ValueError(f"{field_name} is not valid base64 key material: {error}") from error

    try:
        decoded = decoded_bytes.decode("utf-8").strip()
    except UnicodeDecodeError:
        # Direct minisign key line (base64 key material).
        return _encode_pubkey_text(DEFAULT_MINISIGN_PUBKEY_COMMENT, direct)

    if decoded.lstrip().startswith(MINISIGN_COMMENT_PREFIX) or "\n" in decoded:
        comment, key_line = _extract_pubkey_parts_from_text(decoded, field_name=field_name)
        return _encode_pubkey_text(comment, key_line)

    decoded_compact = "".join(decoded.split())
    if _is_base64_blob(decoded_compact):
        # Base64(minisign key-line text) -> normalize into base64(minisign pubkey text).
        return _encode_pubkey_text(DEFAULT_MINISIGN_PUBKEY_COMMENT, decoded_compact)

    raise ValueError(
        f"{field_name} is not valid updater pubkey input: decoded content is neither minisign text nor key material."
    )


def main() -> int:
    args = parse_args()
    output_path = pathlib.Path(args.output)
    updater_endpoint = args.updater_endpoint.strip() or DEFAULT_UPDATER_ENDPOINT
    try:
        updater_pubkey = normalize_updater_pubkey(
            args.updater_pubkey,
            field_name="--updater-pubkey",
        )
    except ValueError as error:
        raise SystemExit(str(error))

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

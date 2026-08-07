#!/usr/bin/env python3

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import unquote, urlsplit

IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable"
CHANNEL_CACHE_CONTROL = "no-store"
VERSION_SEGMENT_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+_-]*$")


@dataclass(frozen=True)
class UploadObject:
    source: Path
    key: str
    cache_control: str
    content_type: str
    mutable: bool = False


def content_type_for(path: Path) -> str:
    lower_name = path.name.lower()
    if lower_name.endswith(".json"):
        return "application/json"
    if lower_name.endswith(".sig"):
        return "text/plain; charset=utf-8"
    if lower_name.endswith(".zip"):
        return "application/zip"
    if lower_name.endswith((".tar.gz", ".gz")):
        return "application/gzip"
    if lower_name.endswith(".exe"):
        return "application/vnd.microsoft.portable-executable"
    if lower_name.endswith(".deb"):
        return "application/vnd.debian.binary-package"
    if lower_name.endswith(".rpm"):
        return "application/x-rpm"
    if lower_name.endswith(".dmg"):
        return "application/x-apple-diskimage"
    return "application/octet-stream"


def build_upload_plan(
    artifacts_root: Path,
    manifest_path: Path,
    version: str,
    release_id: str,
    channel: str,
    phase: str,
) -> list[UploadObject]:
    if not VERSION_SEGMENT_RE.fullmatch(version):
        raise ValueError(f"Invalid release version path segment: {version!r}")
    if not VERSION_SEGMENT_RE.fullmatch(release_id):
        raise ValueError(f"Invalid release ID path segment: {release_id!r}")
    if channel not in {"stable", "nightly"}:
        raise ValueError(f"Unsupported release channel: {channel!r}")
    if phase not in {"artifacts", "channel", "all"}:
        raise ValueError(f"Unsupported publish phase: {phase!r}")

    root = artifacts_root.resolve()
    manifest = manifest_path.resolve()
    if not root.is_dir():
        raise ValueError(f"Artifacts root is not a directory: {root}")
    if not manifest.is_file():
        raise ValueError(f"Updater manifest does not exist: {manifest}")
    if not manifest.is_relative_to(root):
        raise ValueError("Updater manifest must be inside the artifacts root")

    artifacts = sorted(
        path.resolve()
        for path in root.rglob("*")
        if path.is_file() and path.resolve() != manifest
    )
    by_name: dict[str, list[Path]] = {}
    for path in artifacts:
        by_name.setdefault(path.name, []).append(path)
    duplicates = {
        name: paths for name, paths in by_name.items() if len(paths) > 1
    }
    if duplicates:
        details = "; ".join(
            f"{name}: {', '.join(str(path) for path in paths)}"
            for name, paths in sorted(duplicates.items())
        )
        raise ValueError(f"Duplicate artifact filenames cannot be flattened: {details}")

    try:
        manifest_payload = json.loads(manifest.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Invalid updater manifest {manifest}: {exc}") from exc
    if manifest_payload.get("version") != version:
        raise ValueError(
            "Updater manifest version does not match publish version: "
            f"{manifest_payload.get('version')!r} != {version!r}"
        )
    if manifest_payload.get("channel") != channel:
        raise ValueError(
            "Updater manifest channel does not match publish channel: "
            f"{manifest_payload.get('channel')!r} != {channel!r}"
        )

    platforms = manifest_payload.get("platforms")
    if not isinstance(platforms, dict) or not platforms:
        raise ValueError("Updater manifest must contain at least one platform")
    referenced_artifacts: set[str] = set()
    for platform_name, platform in platforms.items():
        if not isinstance(platform, dict):
            raise ValueError(f"Invalid updater platform entry: {platform_name!r}")
        artifact_url = platform.get("url")
        parsed_url = urlsplit(artifact_url) if isinstance(artifact_url, str) else None
        if parsed_url is None or parsed_url.scheme != "https" or not parsed_url.netloc:
            raise ValueError(
                f"Updater platform {platform_name!r} must reference an HTTPS URL"
            )
        artifact_name = Path(unquote(parsed_url.path)).name
        if not artifact_name:
            raise ValueError(
                f"Updater platform {platform_name!r} URL has no artifact filename"
            )
        referenced_artifacts.add(artifact_name)

    required_artifacts = referenced_artifacts | {
        f"{artifact_name}.sig" for artifact_name in referenced_artifacts
    }
    missing_artifacts = sorted(required_artifacts - by_name.keys())
    if missing_artifacts:
        raise ValueError(
            "Updater manifest requires artifacts missing from the upload set: "
            + ", ".join(missing_artifacts)
        )

    updater_artifacts = [by_name[name][0] for name in sorted(required_artifacts)]
    release_prefix = f"desktop/releases/{version}/{release_id}"
    plan: list[UploadObject] = []
    if phase in {"artifacts", "all"}:
        plan.extend(
            UploadObject(
                source=path,
                key=f"{release_prefix}/{path.name}",
                cache_control=IMMUTABLE_CACHE_CONTROL,
                content_type=content_type_for(path),
            )
            for path in updater_artifacts
        )
        plan.append(
            UploadObject(
                source=manifest,
                key=f"{release_prefix}/{manifest.name}",
                cache_control=IMMUTABLE_CACHE_CONTROL,
                content_type="application/json",
            )
        )

    if phase in {"channel", "all"}:
        plan.append(
            UploadObject(
                source=manifest,
                key=f"desktop/channels/{channel}/latest.json",
                cache_control=CHANNEL_CACHE_CONTROL,
                content_type="application/json",
                mutable=True,
            )
        )
    return plan


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def run_aws(
    aws_command: str,
    endpoint_url: str,
    args: list[str],
    *,
    check: bool = True,
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            aws_command,
            "--endpoint-url",
            endpoint_url,
            "--no-cli-pager",
            *args,
        ],
        check=check,
        capture_output=True,
        text=True,
    )


def head_object(
    aws_command: str,
    endpoint_url: str,
    bucket: str,
    key: str,
) -> dict | None:
    result = run_aws(
        aws_command,
        endpoint_url,
        ["s3api", "head-object", "--bucket", bucket, "--key", key],
        check=False,
    )
    if result.returncode == 0:
        return json.loads(result.stdout)

    error = result.stderr.strip()
    if any(marker in error for marker in ("404", "Not Found", "NoSuchKey")):
        return None
    raise RuntimeError(f"Failed to inspect s3://{bucket}/{key}: {error}")


def publish_object(
    upload: UploadObject,
    *,
    aws_command: str,
    endpoint_url: str,
    bucket: str,
) -> None:
    digest = sha256_file(upload.source)
    size = upload.source.stat().st_size
    existing = head_object(aws_command, endpoint_url, bucket, upload.key)

    if existing is not None and not upload.mutable:
        existing_digest = str(existing.get("Metadata", {}).get("sha256") or "")
        existing_size = int(existing.get("ContentLength") or -1)
        if existing_digest == digest and existing_size == size:
            print(f"[publish-r2] immutable object already present: {upload.key}")
            return
        raise RuntimeError(
            "Refusing to overwrite immutable release object with different content: "
            f"s3://{bucket}/{upload.key}"
        )

    result = run_aws(
        aws_command,
        endpoint_url,
        [
            "s3",
            "cp",
            str(upload.source),
            f"s3://{bucket}/{upload.key}",
            "--cache-control",
            upload.cache_control,
            "--content-type",
            upload.content_type,
            "--metadata",
            f"sha256={digest}",
            "--no-progress",
            "--only-show-errors",
        ],
    )
    if result.stdout.strip():
        print(result.stdout.strip())

    uploaded = head_object(aws_command, endpoint_url, bucket, upload.key)
    if uploaded is None:
        raise RuntimeError(f"Uploaded object is missing: s3://{bucket}/{upload.key}")
    uploaded_digest = str(uploaded.get("Metadata", {}).get("sha256") or "")
    uploaded_size = int(uploaded.get("ContentLength") or -1)
    if uploaded_digest != digest or uploaded_size != size:
        raise RuntimeError(
            f"Uploaded object verification failed: s3://{bucket}/{upload.key}"
        )
    print(f"[publish-r2] uploaded and verified: {upload.key}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Publish normalized AstrBot Desktop release assets to Cloudflare R2."
    )
    parser.add_argument("--artifacts-root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--release-id", required=True)
    parser.add_argument("--channel", required=True, choices=["stable", "nightly"])
    parser.add_argument(
        "--phase",
        default="all",
        choices=["artifacts", "channel", "all"],
    )
    parser.add_argument("--bucket", required=True)
    parser.add_argument("--endpoint-url", required=True)
    parser.add_argument("--aws-command", default="aws")
    args = parser.parse_args()

    plan = build_upload_plan(
        Path(args.artifacts_root),
        Path(args.manifest),
        args.version,
        args.release_id,
        args.channel,
        args.phase,
    )
    for upload in plan:
        publish_object(
            upload,
            aws_command=args.aws_command,
            endpoint_url=args.endpoint_url,
            bucket=args.bucket,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

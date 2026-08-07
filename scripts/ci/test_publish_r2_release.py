import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts.ci import publish_r2_release as MODULE


class PublishR2ReleaseTests(unittest.TestCase):
    @staticmethod
    def write_manifest(
        path: Path,
        *,
        version: str,
        channel: str,
        artifact_name: str,
    ) -> None:
        path.write_text(
            json.dumps(
                {
                    "version": version,
                    "channel": channel,
                    "platforms": {
                        "windows-x86_64": {
                            "signature": "signature",
                            "url": (
                                "https://releases.astrbot.app/desktop/releases/"
                                f"{version}/{artifact_name}"
                            ),
                        }
                    },
                }
            ),
            encoding="utf-8",
        )

    def test_build_upload_plan_flattens_artifacts_and_promotes_channel_last(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            nested = root / "nested"
            nested.mkdir()
            artifact = nested / "AstrBot_4.29.0_windows_amd64_setup.exe"
            artifact.write_bytes(b"installer")
            signature = nested / "AstrBot_4.29.0_windows_amd64_setup.exe.sig"
            signature.write_text("signature")
            manifest = root / "latest-stable.json"
            self.write_manifest(
                manifest,
                version="4.29.0",
                channel="stable",
                artifact_name=artifact.name,
            )

            plan = MODULE.build_upload_plan(
                root,
                manifest,
                "4.29.0",
                "12345-1",
                "stable",
                "all",
            )

        self.assertEqual(
            [upload.key for upload in plan],
            [
                "desktop/releases/4.29.0/12345-1/"
                "AstrBot_4.29.0_windows_amd64_setup.exe",
                "desktop/releases/4.29.0/12345-1/"
                "AstrBot_4.29.0_windows_amd64_setup.exe.sig",
                "desktop/releases/4.29.0/12345-1/latest-stable.json",
                "desktop/channels/stable/latest.json",
            ],
        )
        self.assertFalse(plan[-2].mutable)
        self.assertEqual(plan[-2].cache_control, MODULE.IMMUTABLE_CACHE_CONTROL)
        self.assertTrue(plan[-1].mutable)
        self.assertEqual(plan[-1].cache_control, MODULE.CHANNEL_CACHE_CONTROL)

    def test_build_upload_plan_rejects_duplicate_flattened_names(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a").mkdir()
            (root / "b").mkdir()
            (root / "a" / "AstrBot.exe").write_bytes(b"a")
            (root / "b" / "AstrBot.exe").write_bytes(b"b")
            manifest = root / "latest-stable.json"
            self.write_manifest(
                manifest,
                version="4.29.0",
                channel="stable",
                artifact_name="AstrBot.exe",
            )

            with self.assertRaisesRegex(ValueError, "Duplicate artifact filenames"):
                MODULE.build_upload_plan(
                    root,
                    manifest,
                    "4.29.0",
                    "12345-1",
                    "stable",
                    "artifacts",
                )

    def test_channel_phase_only_contains_mutable_manifest_pointer(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            artifact = root / "AstrBot.exe"
            artifact.write_bytes(b"installer")
            (root / "AstrBot.exe.sig").write_text("signature")
            manifest = root / "latest-nightly.json"
            self.write_manifest(
                manifest,
                version="4.29.0-nightly.20260307.abcd1234",
                channel="nightly",
                artifact_name=artifact.name,
            )

            plan = MODULE.build_upload_plan(
                root,
                manifest,
                "4.29.0-nightly.20260307.abcd1234",
                "12345-1",
                "nightly",
                "channel",
            )

        self.assertEqual(len(plan), 1)
        self.assertEqual(plan[0].key, "desktop/channels/nightly/latest.json")
        self.assertTrue(plan[0].mutable)

    def test_build_upload_plan_rejects_manifest_metadata_mismatch(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            artifact = root / "AstrBot.exe"
            artifact.write_bytes(b"installer")
            (root / "AstrBot.exe.sig").write_text("signature")
            manifest = root / "latest-stable.json"
            self.write_manifest(
                manifest,
                version="4.28.0",
                channel="nightly",
                artifact_name=artifact.name,
            )

            with self.assertRaisesRegex(ValueError, "manifest version"):
                MODULE.build_upload_plan(
                    root,
                    manifest,
                    "4.29.0",
                    "12345-1",
                    "stable",
                    "artifacts",
                )

    def test_build_upload_plan_rejects_missing_manifest_artifact(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "other.exe").write_bytes(b"installer")
            manifest = root / "latest-stable.json"
            self.write_manifest(
                manifest,
                version="4.29.0",
                channel="stable",
                artifact_name="AstrBot.exe",
            )

            with self.assertRaisesRegex(ValueError, "missing from the upload set"):
                MODULE.build_upload_plan(
                    root,
                    manifest,
                    "4.29.0",
                    "12345-1",
                    "stable",
                    "artifacts",
                )

    def test_build_upload_plan_ignores_non_updater_release_assets(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            artifact = root / "AstrBot.exe"
            artifact.write_bytes(b"installer")
            (root / "AstrBot.exe.sig").write_text("signature")
            (root / "AstrBot_portable.zip").write_bytes(b"manual download")
            (root / "AstrBot.deb").write_bytes(b"system package")
            manifest = root / "latest-stable.json"
            self.write_manifest(
                manifest,
                version="4.29.0",
                channel="stable",
                artifact_name=artifact.name,
            )

            plan = MODULE.build_upload_plan(
                root,
                manifest,
                "4.29.0",
                "12345-1",
                "stable",
                "artifacts",
            )

        self.assertEqual(
            [upload.source.name for upload in plan],
            ["AstrBot.exe", "AstrBot.exe.sig", "latest-stable.json"],
        )

    def test_build_upload_plan_requires_detached_signature(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            artifact = root / "AstrBot.exe"
            artifact.write_bytes(b"installer")
            manifest = root / "latest-stable.json"
            self.write_manifest(
                manifest,
                version="4.29.0",
                channel="stable",
                artifact_name=artifact.name,
            )

            with self.assertRaisesRegex(ValueError, r"AstrBot\.exe\.sig"):
                MODULE.build_upload_plan(
                    root,
                    manifest,
                    "4.29.0",
                    "12345-1",
                    "stable",
                    "artifacts",
                )

    def test_publish_object_skips_identical_immutable_object(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "AstrBot.exe"
            source.write_bytes(b"installer")
            upload = MODULE.UploadObject(
                source=source,
                key="desktop/releases/4.29.0/12345-1/AstrBot.exe",
                cache_control=MODULE.IMMUTABLE_CACHE_CONTROL,
                content_type="application/vnd.microsoft.portable-executable",
            )
            existing = {
                "ContentLength": source.stat().st_size,
                "Metadata": {"sha256": MODULE.sha256_file(source)},
            }

            with (
                mock.patch.object(MODULE, "head_object", return_value=existing),
                mock.patch.object(MODULE, "run_aws") as run_aws,
            ):
                MODULE.publish_object(
                    upload,
                    aws_command="aws",
                    endpoint_url="https://example.r2.cloudflarestorage.com",
                    bucket="bucket",
                )

        run_aws.assert_not_called()

    def test_publish_object_refuses_changed_immutable_object(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "AstrBot.exe"
            source.write_bytes(b"new installer")
            upload = MODULE.UploadObject(
                source=source,
                key="desktop/releases/4.29.0/12345-1/AstrBot.exe",
                cache_control=MODULE.IMMUTABLE_CACHE_CONTROL,
                content_type="application/vnd.microsoft.portable-executable",
            )
            existing = {
                "ContentLength": len(b"old installer"),
                "Metadata": {"sha256": "old-digest"},
            }

            with (
                mock.patch.object(MODULE, "head_object", return_value=existing),
                mock.patch.object(MODULE, "run_aws") as run_aws,
                self.assertRaisesRegex(RuntimeError, "Refusing to overwrite"),
            ):
                MODULE.publish_object(
                    upload,
                    aws_command="aws",
                    endpoint_url="https://example.r2.cloudflarestorage.com",
                    bucket="bucket",
                )

        run_aws.assert_not_called()


if __name__ == "__main__":
    unittest.main()

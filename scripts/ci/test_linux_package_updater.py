import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from scripts.ci import generate_tauri_latest_json as manifest
from scripts.ci import normalize_release_artifact_filenames as normalize
from scripts.ci.publish_r2_release import build_upload_plan


class LinuxPackageUpdaterTests(unittest.TestCase):
    def test_signed_linux_packages_survive_normalization_manifest_and_r2_upload(self):
        for channel in ("stable", "nightly"):
            with self.subTest(channel=channel), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                version = "4.28.0"
                suffix = ""
                if channel == "nightly":
                    version += "-nightly.20260914.abcd1234"
                    suffix = "_nightly_abcd1234"
                expected = {}
                for arch, target_arch in (("amd64", "x86_64"), ("arm64", "aarch64")):
                    for package in ("deb", "rpm", "AppImage"):
                        directory = root / arch / package
                        directory.mkdir(parents=True)
                        if package == "rpm":
                            source = f"astrbot-desktop-{version}-1.{target_arch}.rpm"
                        else:
                            source = f"astrbot-desktop_{version}_{arch}.{package}"
                        (directory / source).write_bytes(b"installer")
                        signature = f"signature-{arch}-{package}"
                        (directory / f"{source}.sig").write_text(signature)
                        key = f"linux-{target_arch}-{package.lower()}"
                        expected[key] = (
                            f"AstrBot_4.28.0_linux_{arch}{suffix}.{package}", signature
                        )
                with mock.patch("sys.argv", [
                    "normalize", "--root", str(root), "--build-mode", channel,
                    "--source-git-ref", "abcd1234", "--strict-unmatched",
                ]):
                    self.assertEqual(normalize.main(), 0)

                tag = "nightly" if channel == "nightly" else "v4.28.0"
                base = f"https://releases.astrbot.app/desktop/releases/{version}/123-1"
                output = root / f"latest-{channel}.json"
                args = [
                    "manifest", "--artifacts-root", str(root), "--repo", "AstrBotDevs/AstrBot-desktop",
                    "--tag", tag, "--version", version, "--channel", channel,
                    "--output", str(output),
                ]
                if channel == "stable":
                    args += ["--asset-base-url", base]
                for key in expected:
                    args += ["--require-platform", key]
                with mock.patch("sys.argv", args):
                    self.assertEqual(manifest.main(), 0)
                payload = json.loads(output.read_text())
                self.assertEqual(set(payload["platforms"]), set(expected))
                for key, (filename, signature) in expected.items():
                    url_base = base if channel == "stable" else (
                        f"https://github.com/AstrBotDevs/AstrBot-desktop/releases/download/{tag}"
                    )
                    self.assertEqual(payload["platforms"][key], {
                        "url": f"{url_base}/{filename}", "signature": signature,
                    })
                if channel == "stable":
                    plan = build_upload_plan(root, output, version, "123-1", channel, "all")
                    self.assertEqual({item.source.name for item in plan}, {
                        name for filename, _ in expected.values()
                        for name in (filename, f"{filename}.sig")
                    } | {output.name})
                    self.assertEqual(plan[-1].key, "desktop/channels/stable/latest.json")
                    self.assertTrue(plan[-1].mutable)
                    self.assertTrue(all(not item.mutable for item in plan[:-1]))

    def test_missing_linux_signature_blocks_manifest_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "AstrBot_4.28.0_linux_amd64.AppImage.sig").write_text("appimage-signature")
            (root / "AstrBot_4.28.0_linux_amd64.deb").write_bytes(b"unsigned-deb")
            output = root / "latest.json"
            with mock.patch("sys.argv", [
                "manifest", "--artifacts-root", str(root), "--repo", "org/repo",
                "--tag", "v4.28.0", "--version", "4.28.0", "--output", str(output),
                "--require-platform", "linux-x86_64-deb",
            ]), self.assertRaisesRegex(SystemExit, "Missing required updater platforms: linux-x86_64-deb"):
                manifest.main()
            self.assertFalse(output.exists())

    def test_duplicate_linux_package_target_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for arch in ("amd64", "x86_64"):
                (root / f"AstrBot_4.28.0_linux_{arch}.deb.sig").write_text("signature")
            with self.assertRaisesRegex(ValueError, "Duplicate Linux deb artifact"):
                manifest.collect_platforms(root, "org/repo", "v4.28.0", version="4.28.0", channel="stable")

    def test_malformed_package_name_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "AstrBot_4.28.0_linux_ppc64le.deb.sig").write_text("signature")
            with self.assertRaisesRegex(ValueError, "Unexpected Linux package artifact name"):
                manifest.collect_platforms(root, "org/repo", "v4.28.0", version="4.28.0", channel="stable")


if __name__ == "__main__":
    unittest.main()

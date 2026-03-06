import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { test } from 'node:test';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, '..', '..');
const normalizeScript = path.join(projectRoot, 'scripts/ci/normalize-release-artifact-filenames.py');
const generateScript = path.join(projectRoot, 'scripts/ci/generate-tauri-latest-json.py');

const runPython = (scriptPath, args, cwd) => {
  const result = spawnSync('python3', [scriptPath, ...args], {
    cwd,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: python3 ${path.relative(projectRoot, scriptPath)} ${args.join(' ')}`,
        result.stdout.trim(),
        result.stderr.trim(),
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return result;
};

test('release artifact normalization keeps updater signatures aligned for latest.json generation', async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'astrbot-release-artifacts-'));

  try {
    const artifactsDir = path.join(tempDir, 'release-artifacts');
    const sourceSha = '7ac169c5e81cee0acc1416d22d7ee4464a507a8d';

    await mkdir(artifactsDir, { recursive: true });

    await writeFile(
      path.join(artifactsDir, 'AstrBot_4.19.2-nightly.20260306.7ac169c5_x64-setup.exe'),
      'exe',
      'utf8',
    );
    await writeFile(
      path.join(artifactsDir, 'AstrBot_4.19.2-nightly.20260306.7ac169c5_x64-setup.exe.sig'),
      'windows-signature',
      'utf8',
    );
    await writeFile(
      path.join(artifactsDir, 'AstrBot_4.19.2-nightly.20260306.7ac169c5_macos_arm64.app.tar.gz'),
      'tarball',
      'utf8',
    );
    await writeFile(
      path.join(artifactsDir, 'AstrBot_4.19.2-nightly.20260306.7ac169c5_macos_arm64.app.tar.gz.sig'),
      'macos-signature',
      'utf8',
    );

    runPython(
      normalizeScript,
      ['--root', artifactsDir, '--build-mode', 'nightly', '--source-git-ref', sourceSha],
      projectRoot,
    );

    const normalizedWindows = path.join(
      artifactsDir,
      'AstrBot_4.19.2_windows_amd64_setup_nightly_7ac169c5.exe.sig',
    );
    const normalizedMacos = path.join(
      artifactsDir,
      'AstrBot_4.19.2_macos_arm64_nightly_7ac169c5.app.tar.gz.sig',
    );

    await access(normalizedWindows, fsConstants.F_OK);
    await access(normalizedMacos, fsConstants.F_OK);

    const outputPath = path.join(artifactsDir, 'latest.json');
    runPython(
      generateScript,
      [
        '--artifacts-root',
        artifactsDir,
        '--repo',
        'AstrBotDevs/AstrBot-desktop',
        '--tag',
        'nightly',
        '--version',
        '4.19.2-nightly.20260306.7ac169c5',
        '--output',
        outputPath,
      ],
      projectRoot,
    );

    const payload = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.deepEqual(payload.platforms['windows-x86_64'], {
      signature: 'windows-signature',
      url: 'https://github.com/AstrBotDevs/AstrBot-desktop/releases/download/nightly/AstrBot_4.19.2_windows_amd64_setup_nightly_7ac169c5.exe',
    });
    assert.deepEqual(payload.platforms['darwin-aarch64'], {
      signature: 'macos-signature',
      url: 'https://github.com/AstrBotDevs/AstrBot-desktop/releases/download/nightly/AstrBot_4.19.2_macos_arm64_nightly_7ac169c5.app.tar.gz',
    });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

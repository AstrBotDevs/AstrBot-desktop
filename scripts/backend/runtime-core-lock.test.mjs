import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { generateRuntimeCoreLock } from './runtime-core-lock.mjs';

const resolvePython = () => process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');

test('generateRuntimeCoreLock writes installed distribution metadata', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'astrbot-runtime-core-lock-'));
  const outputPath = path.join(fixtureRoot, 'runtime-core-lock.json');

  try {
    generateRuntimeCoreLock({
      runtimePython: { absolute: resolvePython() },
      outputPath,
    });

    const lock = JSON.parse(fs.readFileSync(outputPath, 'utf8'));

    assert.equal(lock.version, 1);
    assert.equal(Array.isArray(lock.distributions), true);
    assert.ok(lock.distributions.length > 0);
    assert.ok(lock.distributions.some((dist) => dist.name && dist.version));
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('backend build invokes runtime core lock generation before manifest output', async () => {
  const buildBackendPath = new URL('./build-backend.mjs', import.meta.url);
  const source = await readFile(buildBackendPath, 'utf8');

  assert.match(source, /generateRuntimeCoreLock/);
  assert.match(source, /runtime-core-lock\.json/);
  assert.match(source, /generateRuntimeCoreLock\(\{\s*runtimePython/s);
});

test('backend launcher exposes the runtime core lock path when present', async () => {
  const launcherTemplatePath = new URL('./templates/launch_backend.py', import.meta.url);
  const source = await readFile(launcherTemplatePath, 'utf8');

  assert.match(source, /ASTRBOT_DESKTOP_CORE_LOCK_PATH/);
  assert.match(source, /APP_DIR\s*\/\s*["']runtime-core-lock\.json["']/);
  assert.match(source, /os\.environ\["ASTRBOT_DESKTOP_CORE_LOCK_PATH"\]/);
});

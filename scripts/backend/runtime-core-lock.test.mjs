import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

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
  assert.match(source, /RUNTIME_CORE_LOCK_ENV\s*=\s*["']ASTRBOT_DESKTOP_CORE_LOCK_PATH["']/);
  assert.match(source, /os\.environ\.setdefault\(RUNTIME_CORE_LOCK_ENV,\s*str\(lock_path\)\)/);
});

test('runtime core lock wrapper leaves output directory creation to the generator script', async () => {
  const runtimeCoreLockPath = new URL('./runtime-core-lock.mjs', import.meta.url);
  const source = await readFile(runtimeCoreLockPath, 'utf8');

  assert.doesNotMatch(source, /mkdirSync\(/);
});

test('runtime core lock helper only suppresses missing top-level metadata', () => {
  const helperPath = fileURLToPath(new URL('./tools/generate_runtime_core_lock.py', import.meta.url));
  const script = String.raw`
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("runtime_core_lock_helper", sys.argv[1])
module = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(module)

class MissingTopLevel:
    def read_text(self, name):
        raise FileNotFoundError

class UnexpectedFailure:
    def read_text(self, name):
        raise RuntimeError("boom")

assert module._read_top_level_modules(MissingTopLevel()) == []

try:
    module._read_top_level_modules(UnexpectedFailure())
except RuntimeError as exc:
    assert str(exc) == "boom"
else:
    raise AssertionError("RuntimeError was suppressed")
`;

  const result = spawnSync(resolvePython(), ['-c', script, helperPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

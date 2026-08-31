import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createRuntimeManifest } from './runtime-manifest.mjs';

test('createRuntimeManifest records Core source identity', () => {
  const manifest = createRuntimeManifest({
    python: 'python/bin/python3',
    entrypoint: 'launch_backend.py',
    app: 'app',
    desktopVersion: 'v4.27.4',
    coreVersion: 'v4.27.4',
    sourceRef: 'v4.27.4',
    sourceCommit: 'a'.repeat(40),
  });

  assert.deepEqual(manifest, {
    mode: 'cpython-runtime',
    python: 'python/bin/python3',
    entrypoint: 'launch_backend.py',
    app: 'app',
    desktopVersion: '4.27.4',
    coreVersion: '4.27.4',
    sourceRef: 'v4.27.4',
    sourceCommit: 'a'.repeat(40),
  });
});

test('createRuntimeManifest keeps optional source identity explicit', () => {
  const manifest = createRuntimeManifest({
    python: 'python/bin/python3',
    entrypoint: 'launch_backend.py',
    app: 'app',
    desktopVersion: '4.27.4-nightly.20260901.abcdef12',
    coreVersion: '4.27.4',
  });

  assert.equal(manifest.sourceRef, null);
  assert.equal(manifest.sourceCommit, null);
});

test('createRuntimeManifest requires a Core version', () => {
  assert.throws(
    () =>
      createRuntimeManifest({
        python: 'python/bin/python3',
        entrypoint: 'launch_backend.py',
        app: 'app',
        desktopVersion: '4.27.4',
        coreVersion: '',
      }),
    /coreVersion must not be empty/,
  );
});

test('createRuntimeManifest rejects backend paths that escape the bundle', () => {
  for (const [field, value] of [
    ['python', '../python.exe'],
    ['python', 'C:\\outside\\python.exe'],
    ['entrypoint', '/tmp/launch_backend.py'],
    ['entrypoint', 'scripts/../launch_backend.py'],
  ]) {
    assert.throws(
      () =>
        createRuntimeManifest({
          python: field === 'python' ? value : 'python/bin/python3',
          entrypoint: field === 'entrypoint' ? value : 'launch_backend.py',
          app: 'app',
          desktopVersion: '4.27.4',
          coreVersion: '4.27.4',
        }),
      new RegExp(`${field} must be a canonical relative path`),
    );
  }
});

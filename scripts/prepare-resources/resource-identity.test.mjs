import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  attestPreparedResourceBundle,
  extractWebuiEntryAssets,
  formatWebuiVersion,
  MINIMUM_PACKAGED_CORE_VERSION,
  requiresDesktopCoreMatch,
  validatePackagedCoreVersion,
  validatePreparedResourceBundle,
  validateWebuiResources,
  writeWebuiVersionMarker,
} from './resource-identity.mjs';

const createBundleFixture = async ({
  desktopVersion = '4.27.4',
  coreVersion = '4.27.4',
} = {}) => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), 'astrbot-resource-identity-'));
  const webuiDir = path.join(projectRoot, 'resources', 'webui');
  const backendDir = path.join(projectRoot, 'resources', 'backend');
  const assetsDir = path.join(webuiDir, 'assets');
  const pythonDir = path.join(backendDir, 'python', 'bin');
  await mkdir(assetsDir, { recursive: true });
  await mkdir(pythonDir, { recursive: true });
  await writeFile(
    path.join(projectRoot, 'package.json'),
    `${JSON.stringify({ version: desktopVersion })}\n`,
    'utf8',
  );
  await writeFile(
    path.join(webuiDir, 'index.html'),
    '<script type="module" src="/assets/index-a1.js"></script>' +
      '<link rel="stylesheet" href="./assets/index-b2.css?build=1">',
    'utf8',
  );
  await writeFile(path.join(assetsDir, 'index-a1.js'), 'export {};\n', 'utf8');
  await writeFile(path.join(assetsDir, 'index-b2.css'), 'body {}\n', 'utf8');
  await writeFile(path.join(pythonDir, 'python3'), '', 'utf8');
  await writeFile(path.join(backendDir, 'launch_backend.py'), '', 'utf8');
  await writeWebuiVersionMarker({ webuiDir, coreVersion });
  await writeFile(
    path.join(backendDir, 'runtime-manifest.json'),
    `${JSON.stringify({
      mode: 'cpython-runtime',
      python: 'python/bin/python3',
      entrypoint: 'launch_backend.py',
      app: 'app',
      desktopVersion,
      coreVersion,
      sourceRef: `v${coreVersion}`,
      sourceCommit: 'a'.repeat(40),
    })}\n`,
    'utf8',
  );
  return { projectRoot, webuiDir, assetsDir, backendDir };
};

test('formatWebuiVersion produces the marker expected by AstrBot Core', () => {
  assert.equal(formatWebuiVersion('4.27.4'), 'v4.27.4');
  assert.equal(formatWebuiVersion('v4.27.4'), 'v4.27.4');
});

test('requiresDesktopCoreMatch mirrors the runtime stable-version rule', () => {
  assert.equal(requiresDesktopCoreMatch('4.27.5'), true);
  assert.equal(requiresDesktopCoreMatch('4.27.5+rebuilt.1'), true);
  assert.equal(requiresDesktopCoreMatch('4.27.5-nightly.20260901.abcdef12'), false);
  assert.equal(requiresDesktopCoreMatch('not-semver'), true);
  assert.equal(requiresDesktopCoreMatch('4.27.5-alpha..1'), true);
  assert.equal(requiresDesktopCoreMatch('4.27.5-01'), true);
});

test('validatePackagedCoreVersion accepts the minimum and newer SemVer variants', () => {
  assert.equal(MINIMUM_PACKAGED_CORE_VERSION, '4.26.0');
  assert.equal(validatePackagedCoreVersion('v4.26.0'), '4.26.0');
  assert.equal(validatePackagedCoreVersion('V4.26.0+desktop.1'), '4.26.0+desktop.1');
  assert.equal(validatePackagedCoreVersion('4.26.1-rc.1'), '4.26.1-rc.1');
  assert.equal(validatePackagedCoreVersion('5.0.0-alpha.1'), '5.0.0-alpha.1');
});

test('validatePackagedCoreVersion rejects versions below the identity capability floor', () => {
  for (const version of ['4.25.99', 'v4.26.0-rc.1']) {
    assert.throws(
      () => validatePackagedCoreVersion(version),
      /packaged resource identity requires Core 4\.26\.0 or newer/,
    );
  }
});

test('validatePackagedCoreVersion rejects malformed semantic versions', () => {
  for (const version of ['4.26', '4.26.0-01', '04.26.0', 'not-semver']) {
    assert.throws(
      () => validatePackagedCoreVersion(version),
      /is not valid semantic version/,
    );
  }
});

test('extractWebuiEntryAssets finds local JavaScript and CSS entries', () => {
  const entries = extractWebuiEntryAssets(
    '<script src="/assets/app.js?x=1"></script>' +
      '<link href="./assets/app.css#theme">' +
      '<script src="https://example.com/external.js"></script>',
  );

  assert.deepEqual(entries, [path.join('assets', 'app.css'), path.join('assets', 'app.js')]);
});

test('validatePreparedResourceBundle accepts a matching stable bundle', async () => {
  const fixture = await createBundleFixture();
  try {
    const identity = await validatePreparedResourceBundle({
      projectRoot: fixture.projectRoot,
      desktopVersion: '4.27.4',
      coreVersion: '4.27.4',
      sourceRepoRef: 'v4.27.4',
      sourceRepoCommit: 'a'.repeat(40),
    });

    assert.equal(identity.webui.webuiVersion, '4.27.4');
    assert.equal(identity.backend.coreVersion, '4.27.4');
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('validatePreparedResourceBundle rejects a Core below the packaged identity minimum', async () => {
  const fixture = await createBundleFixture({
    desktopVersion: '4.25.9',
    coreVersion: '4.25.9',
  });
  try {
    await assert.rejects(
      validatePreparedResourceBundle({
        projectRoot: fixture.projectRoot,
        desktopVersion: '4.25.9',
        coreVersion: 'v4.25.9',
        sourceRepoRef: 'v4.25.9',
        sourceRepoCommit: 'a'.repeat(40),
      }),
      /packaged resource identity requires Core 4\.26\.0 or newer/,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('attestPreparedResourceBundle binds the runtime manifest to WebUI content', async () => {
  const fixture = await createBundleFixture();
  try {
    const options = {
      projectRoot: fixture.projectRoot,
      desktopVersion: '4.27.4',
      coreVersion: '4.27.4',
      sourceRepoRef: 'v4.27.4',
      sourceRepoCommit: 'a'.repeat(40),
    };
    const identity = await attestPreparedResourceBundle(options);
    assert.equal(identity.backend.webui.version, '4.27.4');
    assert.match(identity.backend.webui.indexSha256, /^[0-9a-f]{64}$/);
    assert.equal(identity.backend.webui.entryAssets.length, 2);

    await writeFile(path.join(fixture.assetsDir, 'index-a1.js'), 'export const stale = true;\n', 'utf8');
    await assert.rejects(
      validatePreparedResourceBundle({ ...options, requireWebuiAttestation: true }),
      /WebUI bundle attestation does not match/,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('validatePreparedResourceBundle rejects stable Desktop/Core drift without relying on a source tag', async () => {
  const fixture = await createBundleFixture({ desktopVersion: '4.27.5' });
  try {
    await assert.rejects(
      validatePreparedResourceBundle({
        projectRoot: fixture.projectRoot,
        desktopVersion: '4.27.5',
        coreVersion: '4.27.4',
        sourceRepoRef: 'abcdef0123456789abcdef0123456789abcdef01',
        sourceRepoCommit: 'a'.repeat(40),
      }),
      /Stable bundle version mismatch/,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('validatePreparedResourceBundle allows a derived nightly Desktop version', async () => {
  const fixture = await createBundleFixture({ desktopVersion: '4.27.5-nightly.20260901.abcdef12' });
  try {
    await validatePreparedResourceBundle({
      projectRoot: fixture.projectRoot,
      desktopVersion: '4.27.5-nightly.20260901.abcdef12',
      coreVersion: '4.27.4',
      sourceRepoRef: 'v4.27.4',
      sourceRepoCommit: 'a'.repeat(40),
    });
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('validateWebuiResources rejects a missing index entry asset', async () => {
  const fixture = await createBundleFixture();
  try {
    await rm(path.join(fixture.assetsDir, 'index-a1.js'));
    await assert.rejects(
      validateWebuiResources({
        webuiDir: fixture.webuiDir,
        expectedCoreVersion: '4.27.4',
      }),
      /missing entry asset/,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('validateWebuiResources rejects a stale version marker', async () => {
  const fixture = await createBundleFixture();
  try {
    await writeFile(path.join(fixture.assetsDir, 'version'), 'v4.27.0\n', 'utf8');
    await assert.rejects(
      validateWebuiResources({
        webuiDir: fixture.webuiDir,
        expectedCoreVersion: '4.27.4',
      }),
      /WebUI version mismatch/,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('validatePreparedResourceBundle rejects an escaping backend manifest path', async () => {
  const fixture = await createBundleFixture();
  try {
    const manifestPath = path.join(fixture.backendDir, 'runtime-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.entrypoint = '../launch_backend.py';
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

    await assert.rejects(
      validatePreparedResourceBundle({
        projectRoot: fixture.projectRoot,
        desktopVersion: '4.27.4',
        coreVersion: '4.27.4',
        sourceRepoRef: 'v4.27.4',
        sourceRepoCommit: 'a'.repeat(40),
      }),
      /entrypoint must be a canonical relative path/,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test('validatePreparedResourceBundle rejects a missing backend runtime file', async () => {
  const fixture = await createBundleFixture();
  try {
    await rm(path.join(fixture.backendDir, 'launch_backend.py'));
    await assert.rejects(
      validatePreparedResourceBundle({
        projectRoot: fixture.projectRoot,
        desktopVersion: '4.27.4',
        coreVersion: '4.27.4',
        sourceRepoRef: 'v4.27.4',
        sourceRepoCommit: 'a'.repeat(40),
      }),
      /entrypoint file is missing or unreadable/,
    );
  } finally {
    await rm(fixture.projectRoot, { recursive: true, force: true });
  }
});

test(
  'validatePreparedResourceBundle rejects a backend runtime symlink escape',
  { skip: process.platform === 'win32' },
  async () => {
    const fixture = await createBundleFixture();
    const outsideDir = await mkdtemp(path.join(os.tmpdir(), 'astrbot-runtime-outside-'));
    try {
      const manifestPath = path.join(fixture.backendDir, 'runtime-manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const outsideEntrypoint = path.join(outsideDir, 'outside.py');
      await writeFile(outsideEntrypoint, '', 'utf8');
      await rm(path.join(fixture.backendDir, 'launch_backend.py'));
      await symlink(outsideEntrypoint, path.join(fixture.backendDir, 'launch_backend.py'));
      await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

      await assert.rejects(
        validatePreparedResourceBundle({
          projectRoot: fixture.projectRoot,
          desktopVersion: '4.27.4',
          coreVersion: '4.27.4',
          sourceRepoRef: 'v4.27.4',
          sourceRepoCommit: 'a'.repeat(40),
        }),
        /entrypoint resolves outside the backend directory/,
      );
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
      await rm(outsideDir, { recursive: true, force: true });
    }
  },
);

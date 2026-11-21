import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  getDesktopBridgeExpectations,
  shouldEnforceDesktopBridgeExpectation,
} from './desktop-bridge-expectations.mjs';
import {
  patchDesktopReleaseUpdateIndicator,
  verifyDesktopBridgeArtifacts,
} from './desktop-bridge-checks.mjs';

test('getDesktopBridgeExpectations returns stable expectation metadata', () => {
  const expectations = getDesktopBridgeExpectations();

  assert.ok(expectations.length > 0);
  assert.ok(expectations.some((expectation) => expectation.required === true));
  assert.ok(expectations.some((expectation) => expectation.required === false));
  assert.ok(expectations.some((expectation) => expectation.label === 'chat transport preference read'));
  assert.ok(expectations.some((expectation) => expectation.label === 'chat transport preference write'));
  assert.ok(
    expectations.some((expectation) => expectation.label === 'standalone chat transport preference read'),
  );

  for (const expectation of expectations) {
    assert.equal(Array.isArray(expectation.filePath), true);
    assert.equal(typeof expectation.label, 'string');
    assert.equal(expectation.pattern instanceof RegExp, true);
    assert.equal(typeof expectation.required, 'boolean');
  }
});

test('shouldEnforceDesktopBridgeExpectation always enforces in strict mode', () => {
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(
      { required: false },
      { isDesktopBridgeExpectationStrict: true, isTaggedRelease: true },
    ),
    true,
  );
});

test('shouldEnforceDesktopBridgeExpectation skips optional expectations outside strict mode', () => {
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(
      { required: false },
      { isDesktopBridgeExpectationStrict: false, isTaggedRelease: false },
    ),
    false,
  );
});

test('shouldEnforceDesktopBridgeExpectation downgrades required expectations on tagged release', () => {
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(
      { required: true },
      { isDesktopBridgeExpectationStrict: false, isTaggedRelease: true },
    ),
    false,
  );
});

test('shouldEnforceDesktopBridgeExpectation enforces explicitly required tagged expectations', () => {
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(
      { required: true, alwaysRequired: true },
      { isDesktopBridgeExpectationStrict: false, isTaggedRelease: true },
    ),
    true,
  );
});

test('shouldEnforceDesktopBridgeExpectation enforces required expectations on non-tagged refs', () => {
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(
      { required: true },
      { isDesktopBridgeExpectationStrict: false, isTaggedRelease: false },
    ),
    true,
  );
});

test('shouldEnforceDesktopBridgeExpectation keeps transport migration required on tagged releases', () => {
  const componentExpectation = getDesktopBridgeExpectations().find(
    (expectation) => expectation.label === 'chat transport preference read',
  );

  assert.ok(componentExpectation);
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(componentExpectation.fallbackRequirement, {
      isDesktopBridgeExpectationStrict: false,
      isTaggedRelease: true,
    }),
    true,
  );
});

test('verifyDesktopBridgeArtifacts validates chat transport preference compatibility', async (t) => {
  const dashboardDir = await mkdtemp(path.join(tmpdir(), 'astrbot-dashboard-'));
  t.after(() => rm(dashboardDir, { recursive: true, force: true }));
  const writeSource = async (relativePath, source) => {
    const file = path.join(dashboardDir, ...relativePath.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, source, 'utf8');
  };

  await writeSource(
    'src/App.vue',
    'if (!desktopBridge?.onTrayRestartBackend) { await globalWaitingRef.value?.check?.(prompt); }',
  );
  await writeSource(
    'src/utils/restartAstrBot.ts',
    'import { getDesktopRuntimeInfo } from "@/utils/desktopRuntime"; if (hasDesktopRestartCapability) await getDesktopRuntimeInfo();',
  );
  await writeSource(
    'src/layouts/full/vertical-header/VerticalHeader.vue',
    'const runtimeInfo = await getDesktopRuntimeInfo(); isDesktopReleaseMode.value = runtimeInfo.isDesktopRuntime;',
  );
  await writeSource('src/utils/desktopRuntime.ts', 'console.warn("Desktop runtime detection failed");');

  const chat = 'src/components/chat/Chat.vue';
  const standaloneChat = 'src/components/chat/StandaloneChat.vue';
  const chatPreferences = 'src/utils/chatPreferences.ts';
  const options = {
    dashboardDir,
    projectRoot: dashboardDir,
    sourceRepoRef: 'master',
    isSourceRepoRefVersionTag: false,
    isDesktopBridgeExpectationStrict: true,
  };

  const legacyRead = 'const transportMode = localStorage.getItem("chat.transportMode") === "websocket";';
  const legacyWrite = 'localStorage.setItem("chat.transportMode", mode);';
  const modernChat = [
    'import { chatPreferences } from "@/utils/chatPreferences";',
    'const transportMode = ref(',
    '  chatPreferences().global.transportMode === "websocket" ? "websocket" : "sse",',
    ');',
    'watch(transportMode, (mode) => {',
    '  chatPreferences((preferences) => {',
    '    preferences.global.transportMode = mode;',
    '  });',
    '});',
  ].join('\n');
  const modernStandaloneChat = [
    'import { chatPreferences } from "@/utils/chatPreferences";',
    'const transportMode = ref(',
    '  chatPreferences().global.transportMode === "websocket" ? "websocket" : "sse",',
    ');',
  ].join('\n');
  const migrationSource = [
    'const CHAT_PREFERENCES_KEY = "astrbot.chat.preferences";',
    'export function chatPreferences(update) {',
    '  let preferences = { global: {}, sessions: {} };',
    '  try {',
    '    const target = globalThis.localStorage;',
    '    const migrated = [];',
    '    if (storedUsername) {',
    '      const globalKeys = {',
    '        "chat.transportMode": "transportMode",',
    '      };',
    '      for (const [key, field] of Object.entries(globalKeys)) {',
    '        const value = target.getItem(key);',
    '        if (value !== null) {',
    '          preferences.global[field] ??= value;',
    '          migrated.push(key);',
    '        }',
    '      }',
    '    }',
    '    update?.(preferences);',
    '    if (storedUsername && (update || migrated.length)) {',
    '      target.setItem(CHAT_PREFERENCES_KEY, JSON.stringify(root));',
    '      for (const key of migrated) {',
    '        target.removeItem(key);',
    '      }',
    '    }',
    '  } catch {',
    '  }',
    '  return preferences;',
    '}',
  ].join('\n');

  await writeSource(chat, [legacyRead, legacyWrite].join('\n'));
  await writeSource(standaloneChat, legacyRead);
  await verifyDesktopBridgeArtifacts(options);

  await writeSource(chat, modernChat);
  await writeSource(standaloneChat, modernStandaloneChat);
  await writeSource(chatPreferences, migrationSource);
  await verifyDesktopBridgeArtifacts(options);

  await writeSource(standaloneChat, legacyRead);
  await assert.rejects(
    verifyDesktopBridgeArtifacts(options),
    /chat transport preference formats must match/i,
  );
  await writeSource(chat, [legacyRead, legacyWrite].join('\n'));
  await writeSource(standaloneChat, modernStandaloneChat);
  await assert.rejects(
    verifyDesktopBridgeArtifacts(options),
    /chat transport preference formats must match/i,
  );

  const dualFormatChat = [
    legacyRead,
    legacyWrite,
    'chatPreferences((preferences) => { preferences.global.transportMode = mode; });',
  ].join('\n');
  const invalidMigration = migrationSource.replace(
    '"chat.transportMode": "transportMode"',
    '"chat.transportMode": "legacyTransportMode"',
  );
  await writeSource(chat, dualFormatChat);
  await writeSource(standaloneChat, legacyRead);
  await writeSource(chatPreferences, invalidMigration);
  await assert.rejects(
    verifyDesktopBridgeArtifacts(options),
    /legacy desktop chat transport preference migration/,
  );

  const unrelatedMigration = [
    'const globalKeys = { "chat.transportMode": "transportMode" };',
    'export function chatPreferences() {',
    '  if (false) {',
    '    const value = target.getItem(key);',
    '    preferences.global[field] ??= value;',
    '  }',
    '}',
    'function persistOtherPreferences() {',
    '  target.setItem(CHAT_PREFERENCES_KEY, JSON.stringify(root));',
    '}',
  ].join('\n');
  await writeSource(chat, modernChat);
  await writeSource(standaloneChat, modernStandaloneChat);
  await writeSource(chatPreferences, unrelatedMigration);
  await assert.rejects(
    verifyDesktopBridgeArtifacts(options),
    /legacy desktop chat transport preference migration/,
  );

  const migrationSourceLines = migrationSource.split('\n');
  const tryStart = migrationSourceLines.indexOf('  try {');
  const catchStart = migrationSourceLines.indexOf('  } catch {');
  const unreachableMigration = [
    ...migrationSourceLines.slice(0, tryStart + 1),
    '    if (false) {',
    ...migrationSourceLines.slice(tryStart + 1, catchStart).map((line) => `  ${line}`),
    '    }',
    ...migrationSourceLines.slice(catchStart),
  ].join('\n');
  await writeSource(chatPreferences, unreachableMigration);
  await assert.rejects(
    verifyDesktopBridgeArtifacts(options),
    /legacy desktop chat transport preference migration/,
  );

  await assert.rejects(
    verifyDesktopBridgeArtifacts({
      ...options,
      sourceRepoRef: 'v4.30.0',
      isSourceRepoRefVersionTag: true,
      isDesktopBridgeExpectationStrict: false,
    }),
    /legacy desktop chat transport preference migration/,
  );
});

test('patchDesktopReleaseUpdateIndicator tolerates minor formatting changes in the upstream source', async () => {
  const dashboardDir = await mkdtemp(path.join(tmpdir(), 'astrbot-dashboard-'));
  const headerFile = path.join(
    dashboardDir,
    'src',
    'layouts',
    'full',
    'vertical-header',
    'VerticalHeader.vue',
  );
  await mkdir(path.dirname(headerFile), { recursive: true });
  await writeFile(
    headerFile,
    `function checkUpdate() {
  axios.get('/api/update/check')
    .then((res) => {
        hasNewVersion.value   =   res.data.data.has_new_version;
      if   ( res.data.data.has_new_version )   {
        releaseMessage.value = res.data.message;
        updateStatus.value = t('core.header.version.hasNewVersion');
      } else {
        updateStatus.value = res.data.message;
      }
      dashboardHasNewVersion.value = isDesktopReleaseMode.value
        ? false
        : res.data.data.dashboard_has_new_version;
    })
}
`,
    'utf8',
  );

  await patchDesktopReleaseUpdateIndicator({ dashboardDir, projectRoot: dashboardDir });

  const patched = await readFile(headerFile, 'utf8');
  assert.match(
    patched,
    /const backendHasNewVersion = !isDesktopReleaseMode\.value && res\.data\.data\.has_new_version;/,
  );
  assert.match(patched, /hasNewVersion\.value = backendHasNewVersion;/);
  assert.match(patched, /if \(backendHasNewVersion\) \{/);
  assert.doesNotMatch(patched, /hasNewVersion\.value = res\.data\.data\.has_new_version;/);
});

test('patchDesktopReleaseUpdateIndicator warns when the expected update pattern is missing', async () => {
  const dashboardDir = await mkdtemp(path.join(tmpdir(), 'astrbot-dashboard-'));
  const headerFile = path.join(
    dashboardDir,
    'src',
    'layouts',
    'full',
    'vertical-header',
    'VerticalHeader.vue',
  );
  await mkdir(path.dirname(headerFile), { recursive: true });
  await writeFile(
    headerFile,
    `function checkUpdate() {
  axios.get('/api/update/check')
    .then((res) => {
      updateStatus.value = res.data.message;
    })
}
`,
    'utf8',
  );

  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));

  try {
    await patchDesktopReleaseUpdateIndicator({ dashboardDir, projectRoot: dashboardDir });
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Could not patch desktop release update banner gating/);
  assert.match(warnings[0], /VerticalHeader\.vue/);
});

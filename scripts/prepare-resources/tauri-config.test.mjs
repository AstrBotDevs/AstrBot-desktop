import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const tauriConfigPath = new URL('../../src-tauri/tauri.conf.json', import.meta.url);

test('main Tauri window disables background throttling', async () => {
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, 'utf8'));
  const windows = tauriConfig?.app?.windows;

  assert.ok(Array.isArray(windows), 'expected tauri config app.windows to be an array');

  const mainWindow = windows.find((windowConfig) => windowConfig.label === 'main');

  assert.ok(mainWindow, 'expected tauri config to define a main window');
  assert.equal(
    mainWindow.backgroundThrottling,
    'disabled',
    'expected the main window to disable background throttling',
  );
});

test('main Tauri window starts hidden to avoid silent-launch flash', async () => {
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, 'utf8'));
  const windows = tauriConfig?.app?.windows;

  assert.ok(Array.isArray(windows), 'expected tauri config app.windows to be an array');

  const mainWindow = windows.find((windowConfig) => windowConfig.label === 'main');

  assert.ok(mainWindow, 'expected tauri config to define a main window');
  assert.equal(
    mainWindow.visible,
    false,
    'expected the main window to stay hidden until startup settings are applied',
  );
});

test('desktop updater uses R2 for stable and GitHub Releases for nightly', async () => {
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, 'utf8'));
  const updater = tauriConfig?.plugins?.updater;
  const stableEndpoint = 'https://releases.astrbot.app/desktop/channels/stable/latest.json';
  const nightlyEndpoint = 'https://github.com/AstrBotDevs/AstrBot-desktop/releases/download/nightly/latest-nightly.json';

  assert.deepEqual(updater?.endpoints, [stableEndpoint]);
  assert.deepEqual(updater?.channelEndpoints, {
    stable: stableEndpoint,
    nightly: nightlyEndpoint,
  });
});

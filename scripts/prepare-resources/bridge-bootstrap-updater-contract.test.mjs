import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const bootstrapPath = new URL('../../src-tauri/src/bridge_bootstrap.js', import.meta.url);
const chatTransportContractPath = new URL(
  '../../src-tauri/src/desktop_bridge_chat_transport_contract.json',
  import.meta.url,
);

const flushAsyncWork = () => new Promise((resolve) => setImmediate(resolve));

function createStorage(values) {
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(String(key), String(value));
    },
    removeItem(key) {
      values.delete(String(key));
    },
    clear() {
      values.clear();
    },
  };
}

function runBootstrap(source, authResults, sharedState = {}) {
  const localValues = sharedState.localValues || new Map();
  const sessionValues = sharedState.sessionValues || new Map();
  const navigation = sharedState.navigation || { reloads: 0 };
  sharedState.localValues = localValues;
  sharedState.sessionValues = sessionValues;
  sharedState.navigation = navigation;
  const invocations = [];
  const intervals = [];
  class Storage {}
  if (sharedState.nativeStorage) {
    Object.assign(Storage.prototype, {
      getItem(key) { return this.values.get(key) ?? null; },
      setItem(key, value) { this.values.set(String(key), String(value)); },
      removeItem(key) { this.values.delete(String(key)); },
      clear() { this.values.clear(); },
    });
  }
  const makeStorage = (values) => {
    if (!sharedState.nativeStorage) return createStorage(values);
    const storage = Object.assign(new Storage(), { values });
    if (sharedState.allowStorageOverrides) {
      const { setItem, removeItem, clear } = Storage.prototype;
      return Object.assign(storage, { setItem, removeItem, clear });
    }
    // Native Storage can reject instance-level method overrides.
    return Object.preventExtensions(storage);
  };
  const localStorage = makeStorage(localValues);
  const sessionStorage = makeStorage(sessionValues);
  const location = {
    href: 'http://127.0.0.1:6185/#/auth/login',
    origin: 'http://127.0.0.1:6185',
    hash: '#/auth/login',
    assign() {},
    replace() {},
    reload() {
      navigation.reloads += 1;
    },
    toString() {
      return this.href;
    },
  };
  const window = {
    Storage: sharedState.nativeStorage ? Storage : undefined,
    __TAURI_INTERNALS__: {
      event: sharedState.event,
      async invoke(command, payload = {}) {
        invocations.push({ command, payload });
        if (command === 'desktop_bridge_set_startup_theme') {
          return sharedState.saveTheme?.(payload.theme);
        }
        if (command === 'desktop_bridge_install_app_update' && sharedState.install) {
          return sharedState.install();
        }
        if (command === 'desktop_bridge_get_auth_token') {
          const authResult = authResults.shift();
          if (authResult instanceof Error) {
            throw authResult;
          }
          return authResult ?? {
            ok: false,
            reason: 'No desktop auth response.',
          };
        }
        if (command === 'plugin:event|listen') {
          throw new Error('event bridge is not configured in this test');
        }
        return { ok: true, reason: null };
      },
    },
    localStorage,
    sessionStorage,
    location,
    open: () => null,
    setTimeout: sharedState.setTimeout,
    clearTimeout: sharedState.clearTimeout,
    setInterval(handler, delay) {
      intervals.push({ handler, delay });
      return intervals.length;
    },
  };
  class MockElement {}
  class MockAnchor extends MockElement {}
  const document = {
    addEventListener() {},
    getElementById(id) {
      if (id !== 'app') return null;
      return {
        hasChildNodes() {
          return sharedState.appMounted === true;
        },
      };
    },
  };
  const quietConsole = { warn() {}, error() {}, log() {} };

  runInNewContext(
    source
      .replace('{TRAY_RESTART_BACKEND_EVENT}', 'astrbot://tray-restart-backend')
      .replace('{CHAT_TRANSPORT_MODE_STORAGE_KEY}', 'chat_transport_mode')
      .replace('{CHAT_TRANSPORT_MODE_WEBSOCKET}', 'websocket'),
    {
      window,
      document,
      URL,
      Element: MockElement,
      HTMLAnchorElement: MockAnchor,
      console: quietConsole,
      process: { env: { NODE_ENV: 'production' } },
    },
  );

  return {
    window,
    localStorage,
    sessionStorage,
    invocations,
    intervals,
    navigation,
  };
}

function startupThemeRequests(invocations) {
  return invocations
    .filter(({ command }) => command === 'desktop_bridge_set_startup_theme')
    .map(({ payload }) => payload.theme);
}

for (const allowStorageOverrides of [false, true]) {
  test(`bridge saves theme changes with ${allowStorageOverrides ? 'own' : 'prototype'} storage methods`, async () => {
    const source = await readFile(bootstrapPath, 'utf8');
    const { localStorage, sessionStorage, invocations } = runBootstrap(source, [], {
      nativeStorage: true,
      allowStorageOverrides,
      localValues: new Map([['uiTheme', 'PurpleThemeDark']]),
    });
    for (const method of ['setItem', 'removeItem', 'clear']) {
      assert.equal(Object.hasOwn(localStorage, method), allowStorageOverrides, method);
    }
    await flushAsyncWork();
    assert.deepEqual(startupThemeRequests(invocations), ['dark']);

    sessionStorage.setItem('themeMode', 'light');
    localStorage.setItem('themeMode', 'system');
    localStorage.setItem('uiTheme', 'PurpleThemeDark');
    await flushAsyncWork();
    assert.deepEqual(startupThemeRequests(invocations), ['dark', 'system']);

    localStorage.setItem('themeMode', 'light');
    await flushAsyncWork();
    localStorage.removeItem('themeMode');
    await flushAsyncWork();
    localStorage.clear();
    await flushAsyncWork();
    assert.deepEqual(startupThemeRequests(invocations), ['dark', 'system', 'light', 'dark', 'system']);
  });
}

test('bridge waits for an in-flight theme save before sending the latest choice', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  let finishDarkSave;
  const darkSave = new Promise((resolve) => { finishDarkSave = resolve; });
  const { localStorage, invocations } = runBootstrap(source, [], {
    nativeStorage: true,
    localValues: new Map([['themeMode', 'dark']]),
    saveTheme: (theme) => theme === 'dark' ? darkSave : undefined,
  });
  await flushAsyncWork();
  localStorage.setItem('themeMode', 'system');
  localStorage.setItem('themeMode', 'light');
  await flushAsyncWork();
  assert.deepEqual(startupThemeRequests(invocations), ['dark']);

  finishDarkSave();
  await flushAsyncWork();
  assert.deepEqual(startupThemeRequests(invocations), ['dark', 'light']);
});

test('bridge retries repeated startup theme save failures until the save succeeds', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  const retryDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
  let failuresRemaining = retryDelays.length;
  const timers = [];
  const { invocations } = runBootstrap(source, [], {
    nativeStorage: true,
    localValues: new Map([['themeMode', 'dark']]),
    saveTheme() {
      if (failuresRemaining-- > 0) throw new Error('temporary IPC failure');
    },
    setTimeout: (run, delay) => timers.push({ run, delay }),
  });
  await flushAsyncWork();
  for (const [attempt, delay] of retryDelays.entries()) {
    assert.deepEqual(startupThemeRequests(invocations), Array(attempt + 1).fill('dark'));
    assert.deepEqual(timers.map((timer) => timer.delay), [delay]);
    timers.shift().run();
    await flushAsyncWork();
  }
  assert.deepEqual(startupThemeRequests(invocations), Array(retryDelays.length + 1).fill('dark'));
  assert.equal(timers.length, 0);
});

test('bridge interrupts retry backoff when the Dashboard theme changes', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  const timers = new Map();
  let nextTimerId = 0;
  const { invocations, localStorage } = runBootstrap(source, [], {
    nativeStorage: true,
    localValues: new Map([['themeMode', 'dark']]),
    saveTheme(theme) {
      if (theme === 'dark') throw new Error('temporary IPC failure');
    },
    setTimeout(run) {
      const id = ++nextTimerId;
      timers.set(id, run);
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  await flushAsyncWork();
  localStorage.setItem('uiTheme', 'PurpleThemeDark');
  await flushAsyncWork();
  assert.deepEqual(startupThemeRequests(invocations), ['dark']);
  assert.deepEqual([...timers.keys()], [1]);

  localStorage.setItem('themeMode', 'light');
  await flushAsyncWork();
  assert.deepEqual(startupThemeRequests(invocations), ['dark', 'light']);
  assert.equal(timers.size, 0);
});

test('bridge bootstrap defines astrbotAppUpdater methods', async () => {
  const source = await readFile(bootstrapPath, 'utf8');

  assert.match(source, /window\.astrbotAppUpdater\s*=\s*\{/);
  assert.match(source, /getUpdateChannel:\s*\(\)\s*=>/);
  assert.match(source, /setUpdateChannel:\s*\(channel\)\s*=>/);
  assert.match(source, /checkForAppUpdate:\s*\(\)\s*=>/);
  assert.match(source, /installAppUpdate:\s*async\s*\(onProgress\)\s*=>/);
});

test('bridge bootstrap exposes a repair install action through the desktop bridge', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  assert.match(source, /OPEN_REPAIR_INSTALL:\s*'desktop_bridge_open_repair_install'/);

  const runtime = runBootstrap(source, []);
  const result = await runtime.window.astrbotDesktop.openRepairInstall();

  assert.equal(result.ok, true);
  assert.equal(
    runtime.invocations.at(-1)?.command,
    'desktop_bridge_open_repair_install',
  );
});

for (const fails of [false, true]) {
  test(`update progress subscribes before download and cleans up after ${fails ? 'failure' : 'success'}`, async () => {
    const source = await readFile(bootstrapPath, 'utf8');
    let listener;
    let cleanedUp = false;
    const runtime = runBootstrap(source, [], {
      event: {
        async listen(name, handler) {
          if (name === 'astrbot://app-update-progress') {
            listener = handler;
            return () => { cleanedUp = true; };
          }
          return () => {};
        },
      },
      install() {
        assert.equal(typeof listener, 'function');
        listener({ payload: { phase: 'downloading', downloadedBytes: 50, totalBytes: 100 } });
        listener({ payload: { phase: 'verifying', downloadedBytes: 0, totalBytes: null } });
        if (fails) throw new Error('download failed');
        return { ok: true };
      },
    });
    const received = [];
    const result = await runtime.window.astrbotAppUpdater.installAppUpdate((payload) => received.push(payload));
    assert.equal(result.ok, !fails);
    assert.deepEqual(received.map((event) => event.phase), ['downloading', 'verifying']);
    assert.equal(received[0].downloadedBytes, 50);
    assert.equal(cleanedUp, true);
  });
}

test('update still installs when progress events are unavailable or no callback is supplied', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  const runtime = runBootstrap(source, []);
  assert.equal((await runtime.window.astrbotAppUpdater.installAppUpdate()).ok, true);
  assert.equal((await runtime.window.astrbotAppUpdater.installAppUpdate(() => {})).ok, true);
  assert.equal(runtime.invocations.filter(({ command }) => command === 'desktop_bridge_install_app_update').length, 2);
});

test('bridge bootstrap owns desktop passwordless authentication lifecycle', async () => {
  const source = await readFile(bootstrapPath, 'utf8');

  assert.match(source, /GET_AUTH_TOKEN:\s*'desktop_bridge_get_auth_token'/);
  assert.match(source, /refreshAuthSession:\s*refreshDesktopAuthSession/);
  assert.match(source, /localStorage\?\.setItem\(TOKEN_STORAGE_KEY, token\)/);
  assert.match(source, /localStorage\?\.setItem\(USER_STORAGE_KEY, username\)/);
  assert.match(source, /void refreshDesktopAuthSession\(\);/);
  assert.match(
    source,
    /window\.setInterval\(refreshDesktopAuthSession, DESKTOP_AUTH_REFRESH_INTERVAL_MS\)/,
  );
});

test('bridge bootstrap reloads once after initial auth and reacquires a removed token', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  const sharedState = {};
  const firstRuntime = runBootstrap(
    source,
    [{ ok: true, token: 'first-jwt', username: 'astrbot' }],
    sharedState,
  );

  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(firstRuntime.localStorage.getItem('token'), 'first-jwt');
  assert.equal(firstRuntime.localStorage.getItem('user'), 'astrbot');
  assert.equal(firstRuntime.navigation.reloads, 1);
  assert.equal(firstRuntime.window.location.hash, '#/auth/login');
  assert.equal(firstRuntime.intervals.length, 1);
  assert.equal(firstRuntime.intervals[0].delay, 6 * 60 * 60 * 1000);

  const reloadedRuntime = runBootstrap(
    source,
    [
      { ok: true, token: 'second-jwt', username: 'astrbot' },
      { ok: true, token: 'third-jwt', username: 'astrbot' },
    ],
    sharedState,
  );
  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(reloadedRuntime.localStorage.getItem('token'), 'second-jwt');
  assert.equal(reloadedRuntime.navigation.reloads, 1);
  assert.equal(reloadedRuntime.window.location.hash, '#/auth/login');

  sharedState.appMounted = true;
  reloadedRuntime.localStorage.removeItem('token');
  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(reloadedRuntime.localStorage.getItem('token'), 'third-jwt');
  assert.equal(reloadedRuntime.navigation.reloads, 1);
  assert.equal(reloadedRuntime.window.location.hash, '/welcome');
  assert.ok(
    reloadedRuntime.invocations.filter(
      ({ command }) => command === 'desktop_bridge_get_auth_token',
    ).length >= 2,
  );
});

test('bridge bootstrap preserves password login fallback for older backends', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  const runtime = runBootstrap(source, [
    { ok: false, reason: 'Desktop passwordless authentication is unavailable.' },
  ]);

  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(runtime.localStorage.getItem('token'), null);
  assert.equal(runtime.window.location.hash, '#/auth/login');
});

test('bridge bootstrap handles rejected desktop authentication bridge calls', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  const runtime = runBootstrap(source, [new Error('desktop auth bridge unavailable')]);

  const result = await runtime.window.astrbotDesktop.refreshAuthSession();

  assert.equal(result?.ok, false);
  assert.equal(result?.reason, 'Error: desktop auth bridge unavailable');
  assert.equal(runtime.localStorage.getItem('token'), null);
  assert.equal(runtime.window.location.hash, '#/auth/login');
});

test('bridge bootstrap normalizes unexpected desktop authentication refresh errors', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  const invalidAuthResult = { ok: true, username: 'astrbot' };
  Object.defineProperty(invalidAuthResult, 'token', {
    get() {
      throw new Error('unexpected token access failure');
    },
  });
  const runtime = runBootstrap(source, [invalidAuthResult]);

  const result = await runtime.window.astrbotDesktop.refreshAuthSession();

  assert.equal(result?.ok, false);
  assert.equal(result?.reason, 'Unable to refresh desktop authentication.');
  assert.equal(runtime.localStorage.getItem('token'), null);
  assert.equal(runtime.window.location.hash, '#/auth/login');
});

test('bridge bootstrap transport placeholders are backed by the shared contract', async () => {
  const [source, rawContract] = await Promise.all([
    readFile(bootstrapPath, 'utf8'),
    readFile(chatTransportContractPath, 'utf8'),
  ]);
  const contract = JSON.parse(rawContract);

  assert.equal(typeof contract.storageKey, 'string');
  assert.equal(typeof contract.websocketValue, 'string');
  assert.match(source, /if \(typeof window === 'undefined'\) return;/);
  assert.match(source, /\{CHAT_TRANSPORT_MODE_STORAGE_KEY\}/);
  assert.match(source, /\{CHAT_TRANSPORT_MODE_WEBSOCKET\}/);
});

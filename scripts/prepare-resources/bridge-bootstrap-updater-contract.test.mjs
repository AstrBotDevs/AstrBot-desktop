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

function runBootstrap(source, authResults) {
  const values = new Map();
  const invocations = [];
  const intervals = [];
  const localStorage = {
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
  const location = {
    href: 'http://127.0.0.1:6185/#/auth/login',
    origin: 'http://127.0.0.1:6185',
    hash: '#/auth/login',
    assign() {},
    replace() {},
    toString() {
      return this.href;
    },
  };
  const window = {
    __TAURI_INTERNALS__: {
      async invoke(command, payload = {}) {
        invocations.push({ command, payload });
        if (command === 'desktop_bridge_get_auth_token') {
          return authResults.shift() ?? {
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
    location,
    open: () => null,
    setInterval(handler, delay) {
      intervals.push({ handler, delay });
      return intervals.length;
    },
  };
  class MockElement {}
  class MockAnchor extends MockElement {}
  const document = { addEventListener() {} };
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

  return { window, localStorage, invocations, intervals };
}

test('bridge bootstrap defines astrbotAppUpdater methods', async () => {
  const source = await readFile(bootstrapPath, 'utf8');

  assert.match(source, /window\.astrbotAppUpdater\s*=\s*\{/);
  assert.match(source, /getUpdateChannel:\s*\(\)\s*=>/);
  assert.match(source, /setUpdateChannel:\s*\(channel\)\s*=>/);
  assert.match(source, /checkForAppUpdate:\s*\(\)\s*=>/);
  assert.match(source, /installAppUpdate:\s*\(\)\s*=>/);
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

test('bridge bootstrap automatically authenticates and reacquires a removed token', async () => {
  const source = await readFile(bootstrapPath, 'utf8');
  const runtime = runBootstrap(source, [
    { ok: true, token: 'first-jwt', username: 'astrbot' },
    { ok: true, token: 'second-jwt', username: 'astrbot' },
  ]);

  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(runtime.localStorage.getItem('token'), 'first-jwt');
  assert.equal(runtime.localStorage.getItem('user'), 'astrbot');
  assert.equal(runtime.window.location.hash, '/welcome');
  assert.equal(runtime.intervals.length, 1);
  assert.equal(runtime.intervals[0].delay, 6 * 60 * 60 * 1000);

  runtime.localStorage.removeItem('token');
  await flushAsyncWork();
  await flushAsyncWork();
  assert.equal(runtime.localStorage.getItem('token'), 'second-jwt');
  assert.ok(
    runtime.invocations.filter(
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

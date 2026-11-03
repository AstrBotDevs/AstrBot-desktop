import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

const bootstrapPath = new URL('../../src-tauri/src/bridge_bootstrap.js', import.meta.url);
const bootstrapSource = readFile(bootstrapPath, 'utf8');
const extensionPath = '/api/v1/plugins/extensions/astrbot_plugin_palette/desktop-ui-extension.js';

const settle = async (rounds = 8) => {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

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

function createResponse({
  status = 200,
  contentType = 'application/javascript; charset=utf-8',
  jsonBody = null,
  textBody = '',
} = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new Blob([textBody]).stream(),
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-type' ? contentType : null;
      },
    },
    async json() {
      return jsonBody;
    },
    async text() {
      return textBody;
    },
  };
}

async function createRuntime(options = {}) {
  const invocations = [];
  const requests = [];
  const scripts = [];
  const timers = [];
  const messageListeners = [];
  const warnings = [];
  const frames = options.frames || [];
  const localValues = new Map(options.token ? [['token', options.token]] : []);
  const sessionValues = new Map();
  const localStorage = createStorage(localValues);
  const sessionStorage = createStorage(sessionValues);
  let nextTimerId = 1;
  let settings = options.settings ?? {
    enabled: true,
    plugins: ['astrbot_plugin_palette'],
  };
  const pluginData = options.pluginData ?? [
    { name: 'astrbot_plugin_palette', activated: true },
  ];
  const scriptBodies = options.scriptBodies ?? {
    astrbot_plugin_palette: 'window.__paletteExtensionLoaded = true;',
  };

  const location = {
    href: 'http://127.0.0.1:6185/#/welcome',
    origin: 'http://127.0.0.1:6185',
    hash: '#/welcome',
    assign() {},
    replace() {},
    reload() {},
    toString() {
      return this.href;
    },
  };
  const document = {
    documentElement: { dataset: {} },
    head: {
      appendChild(script) {
        scripts.push(script);
      },
    },
    addEventListener() {},
    querySelectorAll(selector) {
      return selector === 'iframe' ? frames : [];
    },
    getElementById() {
      return null;
    },
    createElement(tagName) {
      assert.equal(tagName, 'script');
      return {
        textContent: '',
        attributes: {},
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
      };
    },
  };
  const window = {
    navigator: { userAgent: '' },
    localStorage,
    sessionStorage,
    location,
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
    },
    setInterval() {
      return 1;
    },
    setTimeout(handler, delay) {
      const timer = { id: nextTimerId, handler, delay, cleared: false };
      nextTimerId += 1;
      timers.push(timer);
      return timer.id;
    },
    clearTimeout(id) {
      const timer = timers.find((candidate) => candidate.id === id);
      if (timer) timer.cleared = true;
    },
  };
  window.__TAURI_INTERNALS__ = {
    event: {
      async listen() {
        return () => {};
      },
    },
    async invoke(command, payload = {}) {
      invocations.push({ command, payload });
      if (command === 'desktop_bridge_get_plugin_ui_extensions') {
        return typeof settings === 'function' ? settings() : settings;
      }
      if (command === 'desktop_bridge_request_plugin_ui_extension') {
        if (options.onRequest) return options.onRequest(payload);
        return { granted: false, reason: 'declined' };
      }
      if (command === 'desktop_bridge_get_auth_token') {
        return options.authResult ?? { ok: false, reason: 'password login' };
      }
      return { ok: true, reason: null };
    },
  };
  window.fetch = async (url, fetchOptions) => {
    requests.push({ url, options: fetchOptions });
    if (options.fetchImpl) {
      return options.fetchImpl({ url, options: fetchOptions, requests });
    }
    if (url === '/api/v1/plugins') {
      return createResponse({
        contentType: 'application/json',
        jsonBody: { data: pluginData },
      });
    }
    const match = /^\/api\/v1\/plugins\/extensions\/([^/]+)\/desktop-ui-extension\.js$/.exec(url);
    if (match) {
      const plugin = decodeURIComponent(match[1]);
      return createResponse({ textBody: scriptBodies[plugin] ?? '' });
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  class MockElement {}
  class MockAnchor extends MockElement {}
  const context = createContext({
    window,
    document,
    URL,
    TextEncoder,
    TextDecoder,
    AbortController,
    Element: MockElement,
    HTMLAnchorElement: MockAnchor,
    console: {
      warn(...args) {
        warnings.push(args.map(String).join(' '));
      },
      error() {},
      log() {},
    },
    process: { env: { NODE_ENV: 'production' } },
  });
  const source = (await bootstrapSource)
    .replace('{TRAY_RESTART_BACKEND_EVENT}', 'astrbot://tray-restart-backend')
    .replace('{CHAT_TRANSPORT_MODE_STORAGE_KEY}', 'chat_transport_mode')
    .replace('{CHAT_TRANSPORT_MODE_WEBSOCKET}', 'websocket');
  const evaluate = () => runInContext(source, context);
  evaluate();
  if (options.settleInitial !== false) await settle();

  return {
    window,
    localStorage,
    invocations,
    requests,
    scripts,
    timers,
    messageListeners,
    warnings,
    frames,
    evaluate,
    setSettings(value) {
      settings = value;
    },
    get state() {
      return window.__astrbotDesktopPluginUiExtensionState;
    },
  };
}

for (const [label, settings] of [
  ['disabled', { enabled: false, plugins: ['astrbot_plugin_palette'] }],
  ['empty', { enabled: true, plugins: [] }],
]) {
  test(`no Core request is made when the master switch is ${label} or grants are ${label}`, async () => {
    const runtime = await createRuntime({ token: 'jwt', settings });
    assert.equal(runtime.requests.length, 0);
    assert.equal(runtime.scripts.length, 0);
  });
}

test('an authorized activated plugin loads once with bearer auth across triggers and bridge reentry', async () => {
  const runtime = await createRuntime({ token: 'jwt-token' });

  assert.equal(runtime.requests.length, 2);
  assert.equal(runtime.requests[0].url, '/api/v1/plugins');
  assert.equal(runtime.requests[1].url, extensionPath);
  for (const request of runtime.requests) {
    assert.equal(request.options.headers.Authorization, 'Bearer jwt-token');
    assert.equal(request.options.headers['Cache-Control'], 'no-store');
    assert.equal(typeof request.options.signal.aborted, 'boolean');
    assert.equal(typeof request.options.signal.addEventListener, 'function');
  }
  assert.equal(runtime.scripts.length, 1);
  assert.equal(
    runtime.scripts[0].attributes['data-astrbot-plugin-ui-extension'],
    'astrbot_plugin_palette',
  );
  assert.equal(runtime.scripts[0].textContent, 'window.__paletteExtensionLoaded = true;');
  assert.equal(runtime.messageListeners.length, 1);

  await runtime.state.load();
  runtime.evaluate();
  await settle();
  assert.equal(runtime.requests.length, 2);
  assert.equal(runtime.scripts.length, 1);
  assert.equal(runtime.messageListeners.length, 1);
});

for (const [label, settings, pluginData] of [
  [
    'not granted',
    { enabled: true, plugins: ['another_plugin'] },
    [{ name: 'astrbot_plugin_palette', activated: true }],
  ],
  [
    'not activated',
    { enabled: true, plugins: ['astrbot_plugin_palette'] },
    [{ name: 'astrbot_plugin_palette', activated: false }],
  ],
]) {
  test(`a plugin is not loaded when it is ${label}`, async () => {
    const runtime = await createRuntime({ token: 'jwt', settings, pluginData });
    assert.equal(runtime.requests.length, 1);
    assert.equal(runtime.scripts.length, 0);
  });
}

for (const [label, response] of [
  [
    'a 200 JSON error',
    createResponse({ contentType: 'application/json', jsonBody: { error: 'missing route' } }),
  ],
  ['a non-JavaScript Content-Type', createResponse({ contentType: 'text/plain', textBody: 'x' })],
  ['an empty script', createResponse({ textBody: '  \n' })],
  ['an oversized script', createResponse({ textBody: 'x'.repeat(8 * 1024 * 1024 + 1) })],
]) {
  test(`no script is inserted for ${label}`, async () => {
    const runtime = await createRuntime({
      token: 'jwt',
      fetchImpl({ url }) {
        if (url === extensionPath) return response;
        return createResponse({
          contentType: 'application/json',
          jsonBody: { data: [{ name: 'astrbot_plugin_palette', activated: true }] },
        });
      },
    });
    assert.equal(runtime.scripts.length, 0);
    assert.equal(runtime.warnings.some((warning) => warning.includes('astrbot_plugin_palette')), true);
  });
}

for (const contentLength of [null, '1']) {
  test(`an oversized stream is cancelled before reading its remainder (Content-Length: ${contentLength})`, async () => {
    const chunks = [new Uint8Array(8 * 1024 * 1024).fill(120), new Uint8Array([120]), new Uint8Array([120])];
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) {
        if (pulls < chunks.length) controller.enqueue(chunks[pulls++]);
        else controller.close();
      },
      cancel() {
        cancelled = true;
      },
    }, { highWaterMark: 0 });
    const headers = { 'Content-Type': 'application/javascript' };
    if (contentLength !== null) headers['Content-Length'] = contentLength;
    const runtime = await createRuntime({
      token: 'jwt',
      fetchImpl({ url }) {
        return url === extensionPath
          ? new Response(body, { headers })
          : createResponse({ jsonBody: { data: [{ name: 'astrbot_plugin_palette', activated: true }] } });
      },
    });
    assert.equal(runtime.scripts.length, 0);
    assert.equal(cancelled, true);
    assert.equal(pulls, 2);
    assert.equal(body.locked, false);
    assert.ok(runtime.warnings.some((warning) => warning.includes('exceeds 8 MiB')));
  });
}

for (const size of [8 * 1024 * 1024 - 1, 8 * 1024 * 1024]) {
  test(`a script of ${size} bytes is accepted`, async () => {
    const source = 'x'.repeat(size);
    const runtime = await createRuntime({ token: 'jwt', scriptBodies: { astrbot_plugin_palette: source } });
    assert.equal(runtime.scripts.length, 1);
    assert.equal(runtime.scripts[0].textContent, source);
  });
}

test('UTF-8 characters split across stream chunks are decoded intact', async () => {
  const source = '// 调色盘🙂';
  const bytes = new TextEncoder().encode(source);
  const runtime = await createRuntime({
    token: 'jwt',
    fetchImpl({ url }) {
      if (url !== extensionPath) {
        return createResponse({ jsonBody: { data: [{ name: 'astrbot_plugin_palette', activated: true }] } });
      }
      return new Response(new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      }), { headers: { 'Content-Type': 'application/javascript' } });
    },
  });
  assert.equal(runtime.scripts.length, 1);
  assert.equal(runtime.scripts[0].textContent, source);
});

test('one plugin network failure does not block another plugin or existing bridge methods', async () => {
  const runtime = await createRuntime({
    token: 'jwt',
    settings: { enabled: true, plugins: ['broken_plugin', 'good_plugin'] },
    pluginData: [
      { name: 'broken_plugin', activated: true },
      { name: 'good_plugin', activated: true },
    ],
    fetchImpl({ url }) {
      if (url.includes('broken_plugin')) throw new Error('network offline');
      if (url.includes('good_plugin')) return createResponse({ textBody: 'window.good = true;' });
      return createResponse({
        contentType: 'application/json',
        jsonBody: {
          data: [
            { name: 'broken_plugin', activated: true },
            { name: 'good_plugin', activated: true },
          ],
        },
      });
    },
  });

  assert.equal(runtime.scripts.length, 1);
  assert.equal(runtime.scripts[0].attributes['data-astrbot-plugin-ui-extension'], 'good_plugin');
  assert.equal((await runtime.window.astrbotDesktop.getBackendState()).ok, true);
});

test('a manually aborted discovery times out without an unhandled rejection', async () => {
  const runtime = await createRuntime({
    token: 'jwt',
    settleInitial: false,
    fetchImpl({ options }) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('manual timeout')));
      });
    },
  });
  await settle(2);
  assert.equal(runtime.requests.length, 1);
  const timer = runtime.timers.find((candidate) => !candidate.cleared);
  assert.ok(timer);
  assert.equal(timer.delay, 8000);
  timer.handler();
  await settle();

  assert.equal(runtime.scripts.length, 0);
  assert.equal((await runtime.window.astrbotDesktop.getBackendState()).ok, true);
});

test('a script body that stalls after its headers is cut off by the same timeout', async () => {
  const runtime = await createRuntime({
    token: 'jwt',
    settleInitial: false,
    fetchImpl({ url, options }) {
      if (url === '/api/v1/plugins') {
        return createResponse({
          contentType: 'application/json',
          jsonBody: { data: [{ name: 'astrbot_plugin_palette', activated: true }] },
        });
      }
      return {
        ...createResponse(),
        body: new ReadableStream({
          start(controller) {
            options.signal.addEventListener('abort', () => controller.error(new Error('body aborted')));
          },
        }),
        text: () =>
          new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('body aborted')));
          }),
      };
    },
  });
  await settle();
  const fetchTimers = runtime.timers.filter((candidate) => candidate.delay === 8000);
  assert.equal(runtime.requests.length, 2);
  assert.equal(fetchTimers.length, 2);
  assert.equal(fetchTimers[0].cleared, true);
  assert.equal(fetchTimers[1].cleared, false);
  fetchTimers[1].handler();
  await settle();

  assert.equal(runtime.scripts.length, 0);
  assert.equal(runtime.state.discoveryPromise, null);
  assert.equal(runtime.warnings.some((warning) => warning.includes('astrbot_plugin_palette')), true);
  assert.equal((await runtime.window.astrbotDesktop.getBackendState()).ok, true);
});

test('a token written after bootstrap starts loading without duplicate work', async () => {
  const runtime = await createRuntime({ token: null });
  assert.equal(runtime.requests.length, 0);

  runtime.localStorage.setItem('token', 'new-jwt');
  await settle();
  assert.equal(runtime.requests.length, 2);
  assert.equal(runtime.scripts.length, 1);

  runtime.localStorage.setItem('token', 'new-jwt');
  await settle();
  assert.equal(runtime.requests.length, 2);
  assert.equal(runtime.scripts.length, 1);
});

test('a successful desktop auth refresh also triggers extension loading', async () => {
  const runtime = await createRuntime({
    token: null,
    authResult: { ok: true, token: 'refresh-jwt', username: 'astrbot' },
  });

  assert.equal(runtime.localStorage.getItem('token'), 'refresh-jwt');
  assert.equal(runtime.requests.length, 2);
  assert.equal(runtime.scripts.length, 1);
});

test('concurrent discovery callers share the in-flight request', async () => {
  let releaseScript;
  const runtime = await createRuntime({
    token: 'jwt',
    settleInitial: false,
    fetchImpl({ url }) {
      if (url === extensionPath) {
        return new Promise((resolve) => {
          releaseScript = () => resolve(createResponse({ textBody: 'window.shared = true;' }));
        });
      }
      return createResponse({
        contentType: 'application/json',
        jsonBody: { data: [{ name: 'astrbot_plugin_palette', activated: true }] },
      });
    },
  });
  await settle(3);
  const pending = runtime.state.discoveryPromise;
  assert.ok(pending);
  assert.equal(runtime.state.load(), pending);
  assert.equal(runtime.state.load(), pending);
  releaseScript();
  await pending;
  await settle();

  assert.equal(runtime.requests.length, 2);
  assert.equal(runtime.scripts.length, 1);
});

test('unexpected or forged authorization messages never invoke the request command', async () => {
  const validSource = { postMessage() {} };
  const runtime = await createRuntime({
    token: null,
    frames: [{ contentWindow: validSource, src: '/api/v1/plugins/palette/views/settings/_t/t/' }],
  });
  const listener = runtime.messageListeners[0];
  assert.equal(typeof listener, 'function');
  const cases = [
    { data: { type: 'other-message' }, source: validSource },
    { data: { type: 'astrbot-desktop:plugin-ui-extension-request' }, source: {} },
    {
      data: { type: 'astrbot-desktop:plugin-ui-extension-request' },
      source: { postMessage() {} },
    },
  ];
  runtime.frames.push(
    { contentWindow: cases[2].source, src: '/api/v1/not-a-plugin-view' },
  );
  for (const [index, src] of [
    'https://example.com/api/v1/plugins/palette/views/settings/_t/t/',
    '/api/v1/plugins/palette/not-views/settings/',
    '/api/v1/plugins/%E0%A4%A/views/settings/_t/t/',
    '/api/v1/plugins/.palette/views/settings/_t/t/',
    '/api/v1/plugins/a%2Fb/views/settings/_t/t/',
  ].entries()) {
    const source = { postMessage() {} };
    runtime.frames.push({ contentWindow: source, src });
    cases.push({
      data: { type: 'astrbot-desktop:plugin-ui-extension-request', requestId: index },
      source,
    });
  }

  for (const event of cases) listener(event);
  await settle();
  assert.equal(
    runtime.invocations.filter(
      ({ command }) => command === 'desktop_bridge_request_plugin_ui_extension',
    ).length,
    0,
  );
});

test('a valid plugin iframe request uses its real path identity and then loads the script', async () => {
  const replies = [];
  const source = {
    postMessage(message, targetOrigin) {
      replies.push({ message, targetOrigin });
    },
  };
  let granted = false;
  const runtime = await createRuntime({
    token: 'jwt',
    settings: { enabled: true, plugins: [] },
    frames: [
      {
        contentWindow: source,
        src: '/api/v1/plugins/astrbot_plugin_palette/views/settings/_t/token/?asset_token=secret',
      },
    ],
    onRequest(payload) {
      assert.equal(payload.plugin, 'astrbot_plugin_palette');
      assert.deepEqual(Object.keys(payload), ['plugin']);
      granted = true;
      runtime.setSettings({ enabled: true, plugins: ['astrbot_plugin_palette'] });
      return { granted: true, reason: 'granted' };
    },
  });
  runtime.messageListeners[0]({
    data: {
      type: 'astrbot-desktop:plugin-ui-extension-request',
      requestId: 'request-42',
      plugin: 'forged_plugin',
      code: 'window.forged = true;',
    },
    source,
  });
  await settle();

  assert.equal(granted, true);
  assert.equal(replies.length, 1);
  assert.equal(replies[0].targetOrigin, '*');
  assert.equal(replies[0].message.type, 'astrbot-desktop:plugin-ui-extension-response');
  assert.equal(replies[0].message.requestId, 'request-42');
  assert.equal(replies[0].message.granted, true);
  assert.equal(replies[0].message.reason, 'granted');
  assert.deepEqual(Object.keys(replies[0].message).sort(), [
    'granted',
    'reason',
    'requestId',
    'type',
  ]);
  assert.equal(runtime.scripts.length, 1);
  assert.equal(
    runtime.scripts[0].attributes['data-astrbot-plugin-ui-extension'],
    'astrbot_plugin_palette',
  );
});

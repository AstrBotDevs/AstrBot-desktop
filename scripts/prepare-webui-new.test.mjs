import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';

import { prepareWebuiNew } from './prepare-webui-new.mjs';

const createOptions = (overrides = {}) => {
  const projectRoot = path.resolve('/project');
  const calls = [];
  return {
    calls,
    options: {
      projectRoot,
      env: {},
      logger: { log() {}, error() {} },
      assertNodeVersion: () => calls.push(['assert-node']),
      loadEnv: () => calls.push(['load-env']),
      pathExists: () => true,
      patchMonaco: async (options) => calls.push(['patch-monaco', options]),
      verifyDesktopBridge: async (options) => calls.push(['verify-bridge', options]),
      spawnCommandSync: (command, args, options) => {
        calls.push(['command', command, args, options]);
        return { status: 0 };
      },
      sync: async (source, target) => calls.push(['sync', source, target]),
      ...overrides,
    },
  };
};

test('prepareWebuiNew builds legacy and React dashboards in compatibility order', async () => {
  const { calls, options } = createOptions({
    env: {
      ASTRBOT_DESKTOP_RELEASE_BASE_URL: ' https://downloads.example.test/releases ',
      ASTRBOT_DESKTOP_STRICT_BRIDGE_EXPECTATIONS: 'On',
    },
  });

  await prepareWebuiNew(options);

  assert.deepEqual(calls.map((call) => call[0]), [
    'assert-node',
    'load-env',
    'patch-monaco',
    'verify-bridge',
    'command',
    'command',
    'command',
    'sync',
    'command',
    'sync',
  ]);

  const verifyCall = calls.find(([type]) => type === 'verify-bridge');
  assert.equal(verifyCall[1].isDesktopBridgeExpectationStrict, true);

  const commands = calls.filter(([type]) => type === 'command');
  assert.deepEqual(commands.map(([, command, args]) => [command, args]), [
    ['node', [path.join(options.projectRoot, 'dashboard', 'scripts', 'subset-mdi-font.mjs')]],
    ['pnpm', ['--dir', path.join(options.projectRoot, 'dashboard'), 'exec', 'vue-tsc', '--noEmit']],
    ['pnpm', ['--dir', path.join(options.projectRoot, 'dashboard'), 'exec', 'vite', 'build', '--base=/legacy/']],
    ['pnpm', ['--dir', path.join(options.projectRoot, 'new-dashboard'), 'build']],
  ]);
  for (const command of commands) {
    assert.equal(
      command[3].env.VITE_ASTRBOT_RELEASE_BASE_URL,
      'https://downloads.example.test/releases',
    );
  }

  const syncCalls = calls.filter(([type]) => type === 'sync');
  assert.deepEqual(syncCalls, [
    [
      'sync',
      path.join(options.projectRoot, 'dashboard', 'dist'),
      path.join(options.projectRoot, 'new-dashboard', 'public', 'legacy'),
    ],
    [
      'sync',
      path.join(options.projectRoot, 'new-dashboard', 'dist'),
      path.join(options.projectRoot, 'resources', 'webui'),
    ],
  ]);
});

test('prepareWebuiNew installs missing dependencies with lockfile awareness', async () => {
  const projectRoot = path.resolve('/project');
  const { calls, options } = createOptions({
    projectRoot,
    pathExists(file) {
      if (file === path.join(projectRoot, 'dashboard', 'pnpm-lock.yaml')) return true;
      if (file === path.join(projectRoot, 'new-dashboard', 'dist', 'index.html')) return true;
      return false;
    },
  });

  await prepareWebuiNew(options);

  const commands = calls.filter(([type]) => type === 'command');
  assert.deepEqual(commands.slice(0, 2).map(([, command, args]) => [command, args]), [
    ['pnpm', ['--dir', path.join(projectRoot, 'dashboard'), 'install', '--frozen-lockfile']],
    ['pnpm', ['--dir', path.join(projectRoot, 'new-dashboard'), 'install']],
  ]);
});

test('prepareWebuiNew rejects missing React build output before publishing resources', async () => {
  const { calls, options } = createOptions({
    pathExists(file) {
      return !file.endsWith(path.join('dist', 'index.html'));
    },
  });

  await assert.rejects(() => prepareWebuiNew(options), /React WebUI build output missing:/);

  const syncCalls = calls.filter(([type]) => type === 'sync');
  assert.equal(syncCalls.length, 1);
  assert.match(syncCalls[0][2], /public[\\/]legacy$/);
});

test('prepareWebuiNew surfaces failed child commands', async () => {
  const { options } = createOptions({
    spawnCommandSync: () => ({ status: 2 }),
  });

  await assert.rejects(
    () => prepareWebuiNew(options),
    /Command failed: node .*subset-mdi-font\.mjs/,
  );
});

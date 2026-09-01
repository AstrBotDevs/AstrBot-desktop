import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { runModeTasks } from './mode-dispatch.mjs';

const createContext = (calls) => ({
  sourceDir: '/tmp/source',
  projectRoot: '/tmp/project',
  desktopVersion: '4.27.5',
  coreVersion: '4.27.5',
  sourceRepoCommit: 'a'.repeat(40),
  sourceRepoRef: 'v4.27.5',
  isSourceRepoRefVersionTag: true,
  isDesktopBridgeExpectationStrict: false,
  pythonBuildStandaloneRelease: '20260211',
  pythonBuildStandaloneVersion: '3.12.12',
});

const createTaskRunner = (calls) => ({
  prepareWebui: async () => calls.push('webui'),
  prepareBackend: async () => calls.push('backend'),
  validatePreparedResources: async () => calls.push('validate'),
});

test('runModeTasks skips handlers in version mode', async () => {
  const calls = [];
  const context = { ...createContext(calls), coreVersion: '4.17.5' };

  await runModeTasks('version', context, createTaskRunner(calls));

  assert.deepEqual(calls, []);
});

test('runModeTasks rejects an unsupported Core before preparing packaged resources', async () => {
  const calls = [];
  const context = { ...createContext(calls), coreVersion: 'v4.25.9' };

  await assert.rejects(
    runModeTasks('all', context, createTaskRunner(calls)),
    /packaged resource identity requires Core 4\.26\.0 or newer/,
  );
  assert.deepEqual(calls, []);
});

test('runModeTasks runs webui handler in webui mode', async () => {
  const calls = [];

  await runModeTasks('webui', createContext(calls), createTaskRunner(calls));

  assert.deepEqual(calls, ['webui']);
});

test('runModeTasks runs backend handler in backend mode', async () => {
  const calls = [];

  await runModeTasks('backend', createContext(calls), createTaskRunner(calls));

  assert.deepEqual(calls, ['backend']);
});

test('runModeTasks runs webui then backend handlers in all mode', async () => {
  const calls = [];

  await runModeTasks('all', createContext(calls), createTaskRunner(calls));

  assert.deepEqual(calls, ['webui', 'backend', 'validate']);
});

test('runModeTasks throws for unsupported mode', async () => {
  await assert.rejects(
    () =>
      runModeTasks('desktop', createContext([]), createTaskRunner([])),
    /Unsupported mode: desktop\. Expected version\/webui\/backend\/all\./,
  );
});

test('prepare:resources uses the single all-mode validation path', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));

  assert.equal(packageJson.scripts['prepare:resources'], 'node scripts/prepare-resources.mjs all');
});

test('prepare:resources always validates the runtime version against Core', async () => {
  const source = await readFile('scripts/prepare-resources.mjs', 'utf8');

  assert.match(
    source,
    /validateAstrbotRuntimeVersion\(\{\s*sourceDir,\s*expectedVersion: coreVersion,\s*\}\)/,
  );
  assert.doesNotMatch(
    source,
    /expectedVersion:\s*desktopVersionOverride\s*&&\s*!isSourceRepoRefVersionTag/,
  );
});

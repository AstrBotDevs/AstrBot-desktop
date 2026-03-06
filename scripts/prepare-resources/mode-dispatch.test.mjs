import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runModeTasks } from './mode-dispatch.mjs';

test('runModeTasks skips handlers in version mode', async () => {
  const calls = [];

  await runModeTasks('version', {
    prepareWebui: async () => calls.push('webui'),
    prepareBackend: async () => calls.push('backend'),
  });

  assert.deepEqual(calls, []);
});

test('runModeTasks runs webui handler in webui mode', async () => {
  const calls = [];

  await runModeTasks('webui', {
    prepareWebui: async () => calls.push('webui'),
    prepareBackend: async () => calls.push('backend'),
  });

  assert.deepEqual(calls, ['webui']);
});

test('runModeTasks runs backend handler in backend mode', async () => {
  const calls = [];

  await runModeTasks('backend', {
    prepareWebui: async () => calls.push('webui'),
    prepareBackend: async () => calls.push('backend'),
  });

  assert.deepEqual(calls, ['backend']);
});

test('runModeTasks runs webui then backend handlers in all mode', async () => {
  const calls = [];

  await runModeTasks('all', {
    prepareWebui: async () => calls.push('webui'),
    prepareBackend: async () => calls.push('backend'),
  });

  assert.deepEqual(calls, ['webui', 'backend']);
});

test('runModeTasks throws for unsupported mode', async () => {
  await assert.rejects(
    () =>
      runModeTasks('desktop', {
        prepareWebui: async () => {},
        prepareBackend: async () => {},
      }),
    /Unsupported mode: desktop\. Expected version\/webui\/backend\/all\./,
  );
});

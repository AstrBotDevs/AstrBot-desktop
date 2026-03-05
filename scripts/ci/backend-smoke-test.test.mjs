import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCliOptions, runCli, usageMessage } from './backend-smoke-test.mjs';

test('parseCliOptions returns default values when no args provided', () => {
  const options = parseCliOptions([]);
  assert.equal(options.backendDir, path.resolve('resources/backend'));
  assert.equal(options.webuiDir, path.resolve('resources/webui'));
  assert.equal(options.startupTimeoutMs, 45_000);
  assert.equal(options.pollIntervalMs, 500);
  assert.equal(options.label, '');
  assert.equal(options.showHelp, false);
});

test('parseCliOptions parses all supported flags', () => {
  const options = parseCliOptions([
    '--backend-dir',
    'tmp/backend',
    '--webui-dir',
    'tmp/webui',
    '--startup-timeout-ms',
    '30000',
    '--poll-interval-ms',
    '250',
    '--label',
    'smoke',
  ]);

  assert.equal(options.backendDir, path.resolve('tmp/backend'));
  assert.equal(options.webuiDir, path.resolve('tmp/webui'));
  assert.equal(options.startupTimeoutMs, 30000);
  assert.equal(options.pollIntervalMs, 250);
  assert.equal(options.label, 'smoke');
  assert.equal(options.showHelp, false);
});

test('parseCliOptions marks help flag without exiting', () => {
  const options = parseCliOptions(['--help']);
  assert.equal(options.showHelp, true);
});

test('parseCliOptions marks short help flag without exiting', () => {
  const options = parseCliOptions(['-h']);
  assert.equal(options.showHelp, true);
});

test('parseCliOptions throws when value is missing for value-required flags', () => {
  const flags = [
    '--backend-dir',
    '--webui-dir',
    '--startup-timeout-ms',
    '--poll-interval-ms',
    '--label',
  ];

  for (const flag of flags) {
    assert.throws(
      () => parseCliOptions([flag]),
      (error) =>
        error instanceof Error &&
        error.message.includes(`Missing value for ${flag}.`) &&
        error.message.includes('Usage: node scripts/ci/backend-smoke-test.mjs [options]'),
    );
  }
});

test('parseCliOptions throws when path flags receive empty values', () => {
  const flags = ['--backend-dir', '--webui-dir'];
  for (const flag of flags) {
    assert.throws(
      () => parseCliOptions([flag, '   ']),
      (error) =>
        error instanceof Error &&
        error.message.includes(`Empty value for ${flag}.`) &&
        error.message.includes('Usage: node scripts/ci/backend-smoke-test.mjs [options]'),
    );
  }
});

test('parseCliOptions throws for invalid numeric values', () => {
  const invalidValues = ['abc', '0', '-1'];
  const numericFlags = ['--startup-timeout-ms', '--poll-interval-ms'];

  for (const flag of numericFlags) {
    for (const rawValue of invalidValues) {
      assert.throws(
        () => parseCliOptions([flag, rawValue]),
        (error) =>
          error instanceof Error &&
          error.message.includes(`Invalid numeric value for ${flag}: ${rawValue}`) &&
          error.message.includes('Usage: node scripts/ci/backend-smoke-test.mjs [options]'),
      );
    }
  }
});

test('parseCliOptions throws for unsupported arguments', () => {
  assert.throws(
    () => parseCliOptions(['--unsupported-flag']),
    (error) =>
      error instanceof Error &&
      error.message.includes('Unsupported argument: --unsupported-flag') &&
      error.message.includes('Usage: node scripts/ci/backend-smoke-test.mjs [options]'),
  );
});

test('usageMessage contains key flags', () => {
  const message = usageMessage();
  assert.match(message, /--backend-dir <path>/);
  assert.match(message, /--webui-dir <path>/);
  assert.match(message, /--startup-timeout-ms <ms>/);
  assert.match(message, /--poll-interval-ms <ms>/);
  assert.match(message, /--label <name>/);
});

test('runCli returns 0 on successful execution with no failure logs', async () => {
  const logs = [];
  const errorLogs = [];
  const exitCode = await runCli(['--label', 'ci-test'], {
    executeMain: async () => {},
    log: (line) => logs.push(String(line)),
    logError: (line) => errorLogs.push(String(line)),
  });

  assert.equal(exitCode, 0);
  assert.equal(errorLogs.length, 0);
  assert.equal(logs.length, 0);
});

test('runCli returns 1 and emits labeled failure message when main throws', async () => {
  const errorLogs = [];
  const exitCode = await runCli(['--label', 'ci-test'], {
    executeMain: async () => {
      throw new Error('boom');
    },
    logError: (line) => errorLogs.push(String(line)),
  });

  assert.equal(exitCode, 1);
  assert.equal(errorLogs.length, 1);
  assert.match(errorLogs[0], /^\[backend-smoke:ci-test\] FAILED: boom/);
});

test('runCli returns 1 and emits parse errors with default prefix', async () => {
  const errorLogs = [];
  const exitCode = await runCli(['--startup-timeout-ms', '0'], {
    logError: (line) => errorLogs.push(String(line)),
  });

  assert.equal(exitCode, 1);
  assert.equal(errorLogs.length, 1);
  assert.match(errorLogs[0], /^\[backend-smoke\] FAILED: Invalid numeric value for --startup-timeout-ms: 0/);
  assert.match(errorLogs[0], /Usage: node scripts\/ci\/backend-smoke-test\.mjs \[options\]/);
});

test('runCli prints usage and returns 0 for --help', async () => {
  const logs = [];
  const errorLogs = [];
  const exitCode = await runCli(['--help'], {
    executeMain: async () => {
      throw new Error('main should not be called in help mode');
    },
    log: (line) => logs.push(String(line)),
    logError: (line) => errorLogs.push(String(line)),
  });

  assert.equal(exitCode, 0);
  assert.equal(errorLogs.length, 0);
  assert.equal(logs.length, 1);
  assert.match(logs[0], /Usage: node scripts\/ci\/backend-smoke-test\.mjs \[options\]/);
});

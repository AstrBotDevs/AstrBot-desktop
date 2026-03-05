import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCliOptions } from './backend-smoke-test.mjs';

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

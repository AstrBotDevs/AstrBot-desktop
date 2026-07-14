import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertSupportedNodeVersion,
  isSupportedNodeVersion,
} from './node-version.mjs';

test('accepts the minimum Node.js version and newer releases', () => {
  assert.equal(isSupportedNodeVersion('20.12.0'), true);
  assert.equal(isSupportedNodeVersion('20.12.1'), true);
  assert.equal(isSupportedNodeVersion('22.0.0'), true);
});

test('rejects Node.js releases older than 20.12', () => {
  assert.equal(isSupportedNodeVersion('20.11.1'), false);
  assert.equal(isSupportedNodeVersion('18.20.8'), false);
  assert.throws(
    () => assertSupportedNodeVersion('20.11.1'),
    /requires Node\.js 20\.12\.0 or newer; current version is 20\.11\.1/,
  );
});

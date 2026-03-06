import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDesktopBridgeExpectations,
  shouldEnforceDesktopBridgeExpectation,
} from './desktop-bridge-expectations.mjs';

test('getDesktopBridgeExpectations returns stable expectation metadata', () => {
  const expectations = getDesktopBridgeExpectations();

  assert.ok(expectations.length > 0);
  assert.ok(expectations.some((expectation) => expectation.required === true));
  assert.ok(expectations.some((expectation) => expectation.required === false));

  for (const expectation of expectations) {
    assert.equal(Array.isArray(expectation.filePath), true);
    assert.equal(typeof expectation.label, 'string');
    assert.equal(expectation.pattern instanceof RegExp, true);
    assert.equal(typeof expectation.required, 'boolean');
  }
});

test('shouldEnforceDesktopBridgeExpectation always enforces in strict mode', () => {
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(
      { required: false },
      { isDesktopBridgeExpectationStrict: true, isTaggedRelease: true },
    ),
    true,
  );
});

test('shouldEnforceDesktopBridgeExpectation skips optional expectations outside strict mode', () => {
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(
      { required: false },
      { isDesktopBridgeExpectationStrict: false, isTaggedRelease: false },
    ),
    false,
  );
});

test('shouldEnforceDesktopBridgeExpectation downgrades required expectations on tagged release', () => {
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(
      { required: true },
      { isDesktopBridgeExpectationStrict: false, isTaggedRelease: true },
    ),
    false,
  );
});

test('shouldEnforceDesktopBridgeExpectation enforces required expectations on non-tagged refs', () => {
  assert.equal(
    shouldEnforceDesktopBridgeExpectation(
      { required: true },
      { isDesktopBridgeExpectationStrict: false, isTaggedRelease: false },
    ),
    true,
  );
});

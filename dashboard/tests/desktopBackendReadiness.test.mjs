import assert from 'node:assert/strict';
import test from 'node:test';

import { waitForDesktopBackendReady } from '../src/utils/desktopBackendReadiness.mjs';

test('returns immediately outside the desktop runtime', async () => {
  assert.equal(await waitForDesktopBackendReady({ bridge: undefined }), false);
});

test('waits until the desktop backend reports running', async () => {
  let checks = 0;
  let clock = 0;
  const ready = await waitForDesktopBackendReady({
    bridge: {
      isDesktop: true,
      async getBackendState() {
        checks += 1;
        return { running: checks >= 3 };
      },
    },
    timeoutMs: 1000,
    pollIntervalMs: 10,
    now: () => clock,
    sleep: async (milliseconds) => {
      clock += milliseconds;
    },
  });

  assert.equal(ready, true);
  assert.equal(checks, 3);
});

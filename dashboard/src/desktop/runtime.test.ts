import { describe, expect, it } from 'vitest';

import { detectDesktopRuntime } from './runtime';

describe('detectDesktopRuntime', () => {
  it('falls back safely without an injected bridge', async () => {
    expect(await detectDesktopRuntime(undefined)).toEqual({
      bridge: undefined,
      canManageBackend: false,
      isDesktop: false,
    });
  });

  it('tolerates a failing desktop probe', async () => {
    const candidate = {
      isDesktop: true,
      isDesktopRuntime: async () => {
        throw new Error('not ready');
      },
      getBackendState: async () => ({ canManage: true, restarting: false, running: true, spawning: false }),
      restartBackend: async () => ({ ok: true }),
      stopBackend: async () => ({ ok: true }),
    } satisfies AstrBotDesktopBridge;
    expect((await detectDesktopRuntime(candidate)).isDesktop).toBe(true);
  });
});

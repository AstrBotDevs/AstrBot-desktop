import { describe, expect, it, vi } from 'vitest';

import { waitForChangedStartTime, waitForDesktopBackendReady } from './readiness';

function bridge(states: Array<Partial<AstrBotDesktopBackendState>>): AstrBotDesktopBridge {
  return {
    isDesktop: true,
    isDesktopRuntime: async () => true,
    getBackendState: vi.fn(async () => ({
      canManage: true,
      restarting: false,
      running: false,
      spawning: false,
      ...states.shift(),
    })),
    restartBackend: async () => ({ ok: true }),
    stopBackend: async () => ({ ok: true }),
  };
}

describe('desktop backend readiness', () => {
  it('is a no-op in a Web runtime', async () => {
    expect(await waitForDesktopBackendReady({ bridge: undefined })).toBe(false);
  });

  it('polls until the desktop backend is running', async () => {
    let clock = 0;
    const candidate = bridge([{ running: false }, { running: true }]);
    expect(
      await waitForDesktopBackendReady({
        bridge: candidate,
        now: () => clock,
        sleep: async () => {
          clock += 10;
        },
        timeoutMs: 100,
      }),
    ).toBe(true);
    expect(candidate.getBackendState).toHaveBeenCalledTimes(2);
  });

  it('waits for startup and restart work to finish after the port opens', async () => {
    let clock = 0;
    const candidate = bridge([
      { running: true, spawning: true },
      { running: true, restarting: true },
      { running: true },
    ]);
    expect(
      await waitForDesktopBackendReady({
        bridge: candidate,
        now: () => clock,
        sleep: async () => {
          clock += 10;
        },
        timeoutMs: 100,
      }),
    ).toBe(true);
    expect(candidate.getBackendState).toHaveBeenCalledTimes(3);
  });

  it('recognizes a changed Web backend start time', async () => {
    let clock = 0;
    const read = vi.fn().mockResolvedValueOnce(1).mockResolvedValue(2);
    expect(
      await waitForChangedStartTime(1, read, {
        now: () => clock,
        sleep: async () => {
          clock += 10;
        },
        timeoutMs: 100,
      }),
    ).toBe(true);
  });
});

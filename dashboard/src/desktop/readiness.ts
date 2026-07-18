const defaultSleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

type WaitOptions = {
  bridge?: AstrBotDesktopBridge;
  now?: () => number;
  pollIntervalMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  timeoutMs?: number;
};

export async function waitForDesktopBackendReady({
  bridge = globalThis.window?.astrbotDesktop,
  now = Date.now,
  pollIntervalMs = 250,
  sleep = defaultSleep,
  timeoutMs = 120_000,
}: WaitOptions = {}) {
  if (!bridge?.isDesktop || typeof bridge.getBackendState !== 'function') return false;
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    try {
      const state = await bridge.getBackendState();
      if (state.running && !state.spawning && !state.restarting) return true;
    } catch {
      // Backend and bridge can both be unavailable briefly during restart.
    }
    await sleep(pollIntervalMs);
  }
  return false;
}

export async function waitForChangedStartTime(
  previous: unknown,
  readStartTime: () => Promise<unknown>,
  { now = Date.now, pollIntervalMs = 500, sleep = defaultSleep, timeoutMs = 30_000 }: Omit<WaitOptions, 'bridge'> = {},
) {
  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    try {
      const current = await readStartTime();
      if (current != null && current !== previous) return true;
    } catch {
      // HTTP failures are expected while the backend process restarts.
    }
    await sleep(pollIntervalMs);
  }
  return false;
}

const defaultSleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForDesktopBackendReady({
  bridge = globalThis.window?.astrbotDesktop,
  timeoutMs = 120000,
  pollIntervalMs = 250,
  now = Date.now,
  sleep = defaultSleep,
} = {}) {
  if (!bridge?.isDesktop || typeof bridge.getBackendState !== 'function') {
    return false;
  }

  const startedAt = now();
  while (now() - startedAt < timeoutMs) {
    try {
      const state = await bridge.getBackendState();
      if (state?.running) {
        return true;
      }
    } catch {
      // The bridge can be briefly unavailable while the Tauri page is loading.
    }
    await sleep(pollIntervalMs);
  }

  console.warn('[desktop-runtime] Timed out waiting for the backend; mounting Dashboard anyway.');
  return false;
}

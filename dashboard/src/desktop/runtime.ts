export type DesktopRuntimeInfo = {
  bridge?: AstrBotDesktopBridge;
  canManageBackend: boolean;
  isDesktop: boolean;
};

export async function detectDesktopRuntime(bridge = globalThis.window?.astrbotDesktop): Promise<DesktopRuntimeInfo> {
  if (!bridge) return { bridge: undefined, canManageBackend: false, isDesktop: false };
  let isDesktop = Boolean(bridge.isDesktop);
  try {
    isDesktop ||= Boolean(await bridge.isDesktopRuntime());
  } catch {
    // A half-initialized Tauri bridge must not prevent the Web UI from mounting.
  }
  return {
    bridge,
    canManageBackend: isDesktop && typeof bridge.restartBackend === 'function',
    isDesktop,
  };
}

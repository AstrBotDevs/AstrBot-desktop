import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo } from 'react';

import { readAuthToken } from '@/auth/storage';
import { statsApi } from '@/api/compat';
import { detectDesktopRuntime } from './runtime';
import { waitForChangedStartTime, waitForDesktopBackendReady } from './readiness';
import { useDesktopStore } from '@/stores/desktop';

type DesktopActions = {
  checkForUpdate: () => Promise<AstrBotDesktopAppUpdateCheckResult | null>;
  installUpdate: () => Promise<AstrBotDesktopResult>;
  refreshBackend: () => Promise<AstrBotDesktopBackendState | null>;
  restartBackend: () => Promise<boolean>;
  setUpdateChannel: (channel: string) => Promise<boolean>;
  stopBackend: () => Promise<boolean>;
};

const DesktopContext = createContext<DesktopActions | null>(null);
const unavailable = (): AstrBotDesktopResult => ({ ok: false, reason: 'Desktop runtime is unavailable.' });
const messageOf = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause));

function extractStartTime(response: unknown) {
  const outer = response as { data?: unknown };
  const envelope = outer?.data as { data?: unknown } | undefined;
  return envelope?.data ?? outer?.data ?? null;
}

export function DesktopProvider({ children }: { children: ReactNode }) {
  const patch = useDesktopStore((state) => state.patch);

  const refreshBackend = useCallback(async () => {
    const bridge = globalThis.window?.astrbotDesktop;
    if (!bridge?.isDesktop) return null;
    try {
      const backend = await bridge.getBackendState();
      const backendStatus = backend.running
        ? 'ready'
        : backend.restarting
          ? 'restarting'
          : backend.spawning
            ? 'starting'
            : 'stopped';
      patch({ backend, backendStatus, error: null });
      return backend;
    } catch (cause) {
      patch({ backendStatus: 'error', error: messageOf(cause) });
      return null;
    }
  }, [patch]);

  const restartBackend = useCallback(async () => {
    patch({ backendStatus: 'restarting', error: null });
    const bridge = globalThis.window?.astrbotDesktop;
    try {
      if (bridge?.isDesktop) {
        const result = await bridge.restartBackend(readAuthToken());
        if (!result.ok) throw new Error(result.reason ?? 'Unable to restart backend.');
        const ready = await waitForDesktopBackendReady({ bridge });
        patch({ backendStatus: ready ? 'ready' : 'error', error: ready ? null : 'Backend restart timed out.' });
        if (ready) await refreshBackend();
        return ready;
      }
      const previous = extractStartTime(await statsApi.startTime());
      await statsApi.restart();
      const ready = await waitForChangedStartTime(previous, async () => extractStartTime(await statsApi.startTime()));
      patch({ backendStatus: ready ? 'ready' : 'error', error: ready ? null : 'Backend restart timed out.' });
      return ready;
    } catch (cause) {
      patch({ backendStatus: 'error', error: messageOf(cause) });
      return false;
    }
  }, [patch, refreshBackend]);

  const stopBackend = useCallback(async () => {
    const bridge = globalThis.window?.astrbotDesktop;
    if (!bridge?.isDesktop) return false;
    const result = await bridge.stopBackend();
    patch(
      result.ok
        ? { backendStatus: 'stopped', error: null }
        : { backendStatus: 'error', error: result.reason ?? 'Unable to stop backend.' },
    );
    return result.ok;
  }, [patch]);

  const checkForUpdate = useCallback(async () => {
    const updater = globalThis.window?.astrbotAppUpdater;
    if (!updater) return null;
    patch({ updateStatus: 'checking', error: null });
    try {
      const update = await updater.checkForAppUpdate();
      patch({
        update,
        updateStatus: update.ok ? (update.hasUpdate ? 'available' : 'current') : 'error',
        error: update.reason ?? null,
      });
      return update;
    } catch (cause) {
      patch({ updateStatus: 'error', error: messageOf(cause) });
      return null;
    }
  }, [patch]);

  const installUpdate = useCallback(async () => {
    const updater = globalThis.window?.astrbotAppUpdater;
    if (!updater) return unavailable();
    patch({ updateStatus: 'installing', error: null });
    const result = await updater.installAppUpdate();
    if (!result.ok) patch({ updateStatus: 'error', error: result.reason ?? 'Unable to install update.' });
    return result;
  }, [patch]);

  const setUpdateChannel = useCallback(
    async (channel: string) => {
      const updater = globalThis.window?.astrbotAppUpdater;
      if (!updater?.setUpdateChannel) return false;
      const result = await updater.setUpdateChannel(channel);
      if (result.ok) patch({ updateChannel: channel });
      return result.ok;
    },
    [patch],
  );

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    void detectDesktopRuntime().then(async (runtime) => {
      if (!active) return;
      patch({ isDesktop: runtime.isDesktop, runtimeChecked: true });
      if (!runtime.isDesktop || !runtime.bridge) return;
      await refreshBackend();
      unsubscribe = runtime.bridge.onTrayRestartBackend?.(() => {
        patch({ backendStatus: 'restarting', error: null });
        void waitForDesktopBackendReady({ bridge: runtime.bridge }).then(() => refreshBackend());
      });
      const updater = globalThis.window?.astrbotAppUpdater;
      if (updater?.getUpdateChannel) {
        const result = await updater.getUpdateChannel();
        if (result.ok && result.channel) patch({ updateChannel: result.channel });
      }
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [patch, refreshBackend]);

  const actions = useMemo<DesktopActions>(
    () => ({
      checkForUpdate,
      installUpdate,
      refreshBackend,
      restartBackend,
      setUpdateChannel,
      stopBackend,
    }),
    [checkForUpdate, installUpdate, refreshBackend, restartBackend, setUpdateChannel, stopBackend],
  );
  return <DesktopContext.Provider value={actions}>{children}</DesktopContext.Provider>;
}

export function useDesktop() {
  const context = useContext(DesktopContext);
  if (!context) throw new Error('useDesktop must be used inside DesktopProvider.');
  return context;
}

export function DesktopRestartStatus() {
  const status = useDesktopStore((state) => state.backendStatus);
  if (status !== 'restarting' && status !== 'starting') return null;
  return (
    <div aria-live="polite" className="desktop-restart-status" role="status">
      AstrBot backend is restarting…
    </div>
  );
}

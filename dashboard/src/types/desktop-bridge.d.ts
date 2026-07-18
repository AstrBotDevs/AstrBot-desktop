export {};

declare global {
  type AstrBotDesktopResult = { ok: boolean; reason?: string | null };

  interface AstrBotDesktopBackendState {
    running: boolean;
    spawning: boolean;
    restarting: boolean;
    canManage: boolean;
  }

  interface AstrBotDesktopBridge {
    __tauriBridge?: boolean;
    isDesktop: boolean;
    isDesktopRuntime: () => Promise<boolean>;
    getBackendState: () => Promise<AstrBotDesktopBackendState>;
    restartBackend: (authToken?: string | null) => Promise<AstrBotDesktopResult>;
    stopBackend: () => Promise<AstrBotDesktopResult>;
    openExternalUrl?: (url: string) => Promise<AstrBotDesktopResult>;
    onTrayRestartBackend?: (callback: () => void) => () => void;
  }

  interface AstrBotDesktopAppUpdateCheckResult extends AstrBotDesktopResult {
    currentVersion?: string;
    latestVersion?: string | null;
    hasUpdate: boolean;
  }

  interface AstrBotAppUpdaterBridge {
    getUpdateChannel?: () => Promise<AstrBotDesktopResult & { channel?: string }>;
    setUpdateChannel?: (channel: string) => Promise<AstrBotDesktopResult>;
    checkForAppUpdate: () => Promise<AstrBotDesktopAppUpdateCheckResult>;
    installAppUpdate: () => Promise<AstrBotDesktopResult>;
  }

  interface Window {
    astrbotDesktop?: AstrBotDesktopBridge;
    astrbotAppUpdater?: AstrBotAppUpdaterBridge;
  }
}

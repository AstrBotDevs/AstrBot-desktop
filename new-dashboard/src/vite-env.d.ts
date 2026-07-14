/// <reference types="vite/client" />

interface AstrBotDesktopBridge {
  isDesktop?: boolean;
  onTrayRestartBackend?: (callback: () => void | Promise<void>) => (() => void);
  [key: string]: unknown;
}

interface AstrBotAppUpdaterBridge {
  [key: string]: unknown;
}

interface Window {
  astrbotDesktop?: AstrBotDesktopBridge;
  astrbotAppUpdater?: AstrBotAppUpdaterBridge;
}

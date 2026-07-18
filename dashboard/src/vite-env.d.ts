/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ASTRBOT_ANNOUNCEMENT_CACHE_TTL_MS?: string;
  readonly VITE_ASTRBOT_ANNOUNCEMENT_ENABLED?: string;
  readonly VITE_ASTRBOT_ANNOUNCEMENT_RETRIES?: string;
  readonly VITE_ASTRBOT_ANNOUNCEMENT_TIMEOUT_MS?: string;
  readonly VITE_ASTRBOT_ANNOUNCEMENT_URL?: string;
  readonly VITE_ASTRBOT_DOCS_URL?: string;
  readonly VITE_ASTRBOT_GITHUB_URL?: string;
}

interface AstrBotDesktopBridge {
  isDesktop?: boolean;
  onTrayRestartBackend?: (callback: () => void | Promise<void>) => () => void;
  [key: string]: unknown;
}

interface AstrBotAppUpdaterBridge {
  [key: string]: unknown;
}

interface Window {
  astrbotDesktop?: AstrBotDesktopBridge;
  astrbotAppUpdater?: AstrBotAppUpdaterBridge;
}

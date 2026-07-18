export type FullscreenCapability = {
  activeElement: () => Element | null;
  toggle: (element: Element) => Promise<boolean>;
};

export type BrowserCapabilities = {
  copyText: (text: string) => Promise<void>;
  createObjectUrl: (blob: Blob) => string;
  downloadBlob: (blob: Blob, filename: string) => Promise<void>;
  fullscreen: FullscreenCapability;
  openExternal: (url: string) => Promise<boolean>;
  revokeObjectUrl: (url: string) => void;
};

export type BrowserCapabilityDependencies = {
  document?: Document;
  navigator?: Navigator;
  openWindow?: Window['open'];
  url?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
  desktopBridge?: AstrBotDesktopBridge;
};

type ResolvedDependencies = BrowserCapabilityDependencies & {
  url: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
};

function dependencies(overrides: BrowserCapabilityDependencies = {}): ResolvedDependencies {
  const documentValue = overrides.document ?? globalThis.document;
  const navigatorValue = overrides.navigator ?? globalThis.navigator;
  const openWindow = overrides.openWindow ?? globalThis.window?.open?.bind(globalThis.window);
  const url = overrides.url ?? globalThis.URL;
  return {
    desktopBridge: overrides.desktopBridge ?? globalThis.window?.astrbotDesktop,
    document: documentValue,
    navigator: navigatorValue,
    openWindow,
    url,
  };
}

export function createBrowserCapabilities(overrides: BrowserCapabilityDependencies = {}): BrowserCapabilities {
  const runtime = () => dependencies(overrides);
  const createObjectUrl = (blob: Blob) => runtime().url.createObjectURL(blob);
  const revokeObjectUrl = (url: string) => runtime().url.revokeObjectURL(url);

  return {
    async copyText(text) {
      const { document, navigator } = runtime();
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
      }
      if (!document) throw new Error('Clipboard API is unavailable.');
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        if (!document.execCommand?.('copy')) throw new Error('Clipboard API is unavailable.');
      } finally {
        textarea.remove();
      }
    },
    createObjectUrl,
    async downloadBlob(blob, filename) {
      const { document } = runtime();
      if (!document) throw new Error('Download API is unavailable.');
      const objectUrl = createObjectUrl(blob);
      const anchor = document.createElement('a');
      try {
        anchor.href = objectUrl;
        anchor.download = filename;
        anchor.style.display = 'none';
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        revokeObjectUrl(objectUrl);
      }
    },
    fullscreen: {
      activeElement: () => runtime().document?.fullscreenElement ?? null,
      async toggle(element) {
        const { document } = runtime();
        if (!document) throw new Error('Fullscreen API is unavailable.');
        if (document.fullscreenElement) {
          await document.exitFullscreen();
          return false;
        }
        await element.requestFullscreen();
        return true;
      },
    },
    async openExternal(value) {
      let url: URL;
      try {
        url = new URL(value, globalThis.window?.location.href);
      } catch {
        return false;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
      const { desktopBridge, openWindow } = runtime();
      if (desktopBridge?.isDesktop && desktopBridge.openExternalUrl) {
        return (await desktopBridge.openExternalUrl(url.href)).ok;
      }
      openWindow?.(url.href, '_blank', 'noopener,noreferrer');
      return Boolean(openWindow);
    },
    revokeObjectUrl,
  };
}

export const browserCapabilities = createBrowserCapabilities();

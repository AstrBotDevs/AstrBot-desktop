import { describe, expect, it, vi } from 'vitest';

import { createBrowserCapabilities } from './browserCapabilities';

function fakeDocument({ clickError }: { clickError?: Error } = {}) {
  const anchor = {
    click: vi.fn(() => {
      if (clickError) throw clickError;
    }),
    download: '',
    href: '',
    remove: vi.fn(),
    style: { display: '' },
  };
  const document = {
    body: { appendChild: vi.fn() },
    createElement: vi.fn(() => anchor),
    exitFullscreen: vi.fn(async () => undefined),
    fullscreenElement: null,
  } as unknown as Document;
  return { anchor, document };
}

describe('browser capabilities', () => {
  it('downloads through a temporary object URL and always releases it', async () => {
    const { anchor, document } = fakeDocument();
    const url = {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    };
    const adapter = createBrowserCapabilities({ document, navigator: {} as Navigator, url });
    const blob = new Blob(['content']);

    await adapter.downloadBlob(blob, 'report.json');

    expect(url.createObjectURL).toHaveBeenCalledWith(blob);
    expect(anchor.download).toBe('report.json');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('releases the object URL when the synthetic click fails', async () => {
    const { document } = fakeDocument({ clickError: new Error('blocked') });
    const url = {
      createObjectURL: vi.fn(() => 'blob:download'),
      revokeObjectURL: vi.fn(),
    };
    const adapter = createBrowserCapabilities({ document, navigator: {} as Navigator, url });

    await expect(adapter.downloadBlob(new Blob(), 'file.zip')).rejects.toThrow('blocked');
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('copies text through the injected clipboard', async () => {
    const writeText = vi.fn(async () => undefined);
    const adapter = createBrowserCapabilities({
      document: fakeDocument().document,
      navigator: { clipboard: { writeText } } as unknown as Navigator,
    });
    await adapter.copyText('secret');
    expect(writeText).toHaveBeenCalledWith('secret');
  });

  it('uses the desktop bridge before the browser window for external links', async () => {
    const openExternalUrl = vi.fn(async () => ({ ok: true }));
    const openWindow = vi.fn();
    const adapter = createBrowserCapabilities({
      desktopBridge: { isDesktop: true, openExternalUrl } as unknown as AstrBotDesktopBridge,
      document: fakeDocument().document,
      navigator: {} as Navigator,
      openWindow,
    });

    await expect(adapter.openExternal('https://docs.astrbot.app/path')).resolves.toBe(true);
    expect(openExternalUrl).toHaveBeenCalledWith('https://docs.astrbot.app/path');
    expect(openWindow).not.toHaveBeenCalled();
    await expect(adapter.openExternal('javascript:alert(1)')).resolves.toBe(false);
  });
});

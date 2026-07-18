import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import type { BrowserCapabilities } from './browserCapabilities';
import { BrowserCapabilitiesProvider, useBrowserCapabilities } from './BrowserCapabilitiesProvider';

describe('BrowserCapabilitiesProvider', () => {
  it('injects a fake adapter without replacing browser globals', () => {
    const adapter: BrowserCapabilities = {
      copyText: vi.fn(async () => undefined),
      createObjectUrl: vi.fn(() => 'blob:fake'),
      downloadBlob: vi.fn(async () => undefined),
      fullscreen: {
        activeElement: vi.fn(() => null),
        toggle: vi.fn(async () => true),
      },
      openExternal: vi.fn(async () => true),
      revokeObjectUrl: vi.fn(),
    };
    const Probe = () => {
      const capabilities = useBrowserCapabilities();
      return <span>{capabilities === adapter ? 'fake-adapter' : 'default-adapter'}</span>;
    };

    expect(
      renderToStaticMarkup(
        <BrowserCapabilitiesProvider adapter={adapter}>
          <Probe />
        </BrowserCapabilitiesProvider>,
      ),
    ).toContain('fake-adapter');
  });
});

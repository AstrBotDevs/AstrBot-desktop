import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { renderStatic } from '@/test/render';
import { FullLayout, getFullLayoutMode } from './FullLayout';

vi.mock('@/routes/chat/ChatPage', () => ({ default: () => null }));

function renderLayout(pathname: string) {
  return renderStatic(
    <MemoryRouter initialEntries={[pathname]}>
      <FullLayout header={<span>Header</span>} sidebar={<span>Sidebar</span>}>
        <p>Page content</p>
      </FullLayout>
    </MemoryRouter>,
  );
}

describe('getFullLayoutMode', () => {
  it('identifies chat and plugin pages as full-screen routes', () => {
    expect(getFullLayoutMode('/chat/conversation-1')).toEqual({
      isPluginPageRoute: false,
      isFullScreenRoute: true,
      isWorkspaceRoute: true,
    });
    expect(getFullLayoutMode('/plugin-page/example/settings')).toEqual({
      isPluginPageRoute: true,
      isFullScreenRoute: true,
      isWorkspaceRoute: false,
    });
    expect(getFullLayoutMode('/settings').isFullScreenRoute).toBe(false);
  });
});

describe('FullLayout', () => {
  it('renders the complete shell for standard routes', () => {
    const markup = renderLayout('/settings');

    expect(markup).toContain('data-layout-mode="standard"');
    expect(markup).toContain('full-layout__header');
    expect(markup).toContain('full-layout__sidebar');
    expect(markup).toContain('full-layout__footer');
    expect(markup).not.toContain('href="/console"');
    expect(markup).toContain('data-tooltip="core.navigation.console"');
    expect(markup).not.toContain('full-layout__page--fullscreen');
    expect(markup).toContain('>Page content<');
  });

  it('keeps the shared sidebar available for chat navigation', () => {
    const markup = renderLayout('/chat/conversation-1');

    expect(markup).toContain('data-layout-mode="workspace"');
    expect(markup).not.toContain('full-layout--without-sidebar');
    expect(markup).toContain('full-layout__sidebar');
    expect(markup).toContain('full-layout__footer');
    expect(markup).toContain('full-layout__page--fullscreen');
  });

  it('keeps the sidebar on full-screen plugin pages', () => {
    const markup = renderLayout('/plugin-page/example/settings');

    expect(markup).toContain('data-layout-mode="plugin"');
    expect(markup).toContain('full-layout__sidebar');
    expect(markup).toContain('full-layout__page--plugin');
  });

  it.each(['/extension', '/extension-marketplace', '/capabilities'])(
    'aligns the page navigation to the top for %s',
    (pathname) => {
      expect(renderLayout(pathname)).toContain('full-layout__page--flush-top');
    },
  );

  it('keeps plugin detail content spacing unchanged', () => {
    expect(renderLayout('/extension/example')).not.toContain('full-layout__page--flush-top');
  });
});

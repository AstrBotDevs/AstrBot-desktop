import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { FullLayout, getFullLayoutMode } from './FullLayout';

function renderLayout(pathname: string) {
  return renderToStaticMarkup(
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
      isChatRoute: true,
      isPluginPageRoute: false,
      isFullScreenRoute: true,
    });
    expect(getFullLayoutMode('/plugin-page/example/settings')).toEqual({
      isChatRoute: false,
      isPluginPageRoute: true,
      isFullScreenRoute: true,
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
    expect(markup).not.toContain('full-layout__page--fullscreen');
    expect(markup).toContain('>Page content<');
  });

  it('hides the sidebar and uses full-screen content on chat routes', () => {
    const markup = renderLayout('/chat/conversation-1');

    expect(markup).toContain('data-layout-mode="chat"');
    expect(markup).toContain('full-layout--without-sidebar');
    expect(markup).not.toContain('full-layout__sidebar');
    expect(markup).toContain('full-layout__page--fullscreen');
  });

  it('keeps the sidebar on full-screen plugin pages', () => {
    const markup = renderLayout('/plugin-page/example/settings');

    expect(markup).toContain('data-layout-mode="plugin"');
    expect(markup).toContain('full-layout__sidebar');
    expect(markup).toContain('full-layout__page--plugin');
  });
});

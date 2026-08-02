// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SIDEBAR_DEFAULT_WIDTH, useLayoutStore } from '@/stores/layout';
import { mockApiResponse, renderRoute } from '@/test/render';
import { Sidebar } from './Sidebar';

const openapiMock = vi.hoisted(() => ({ listPlugins: vi.fn() }));

vi.mock('@/api/openapi', () => ({ listPlugins: openapiMock.listPlugins }));
vi.mock('@/routes/chat/ChatPage', () => ({
  default: ({ sidebarOnly }: { sidebarOnly?: boolean }) =>
    sidebarOnly ? <div data-testid="persistent-chat-sidebar" /> : null,
}));
vi.mock('@/desktop/DesktopProvider', () => ({
  useDesktop: () => ({ checkForUpdate: vi.fn(), installUpdate: vi.fn() }),
}));

describe('Sidebar', () => {
  beforeEach(() => {
    localStorage.clear();
    openapiMock.listPlugins.mockReset();
    openapiMock.listPlugins.mockResolvedValue(
      mockApiResponse([
        {
          activated: true,
          display_name: 'Example plugin',
          name: 'example',
          pages: [{ name: 'settings' }],
        },
      ]),
    );
    useLayoutStore.setState({
      drawerOpen: true,
      miniSidebar: false,
      openedGroups: [],
      settingsOpen: false,
      settingsSection: 'general',
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    });
  });

  it('opens settings in a dialog instead of navigating', async () => {
    const user = userEvent.setup();
    renderRoute(<Sidebar />, { route: '/welcome' });

    await user.click(screen.getByRole('button', { name: 'core.navigation.settings' }));

    expect(useLayoutStore.getState().settingsOpen).toBe(true);
    const menu = screen.getByRole('button', { name: 'core.header.buttons.menu' });
    expect(menu.closest('.sidebar-footer')).not.toBeNull();
    await user.click(menu);
    expect(screen.getByText('core.common.language')).toBeInTheDocument();
  });

  it.each(['/welcome', '/chat/session-1'])('keeps one conversation navigation mounted on %s', (route) => {
    const { container } = renderRoute(<Sidebar />, { route });

    expect(screen.getByTestId('persistent-chat-sidebar')).toBeInTheDocument();
    expect(container.querySelector('.sidebar--chat')).toBeNull();
    expect(container.querySelector('#chat-sidebar-slot')).toBeNull();
  });

  it('loads plugin navigation and supports keyboard resizing', async () => {
    const user = userEvent.setup();
    renderRoute(<Sidebar />, { route: '/welcome' });

    expect(screen.getByRole('link', { name: 'core.navigation.welcome' })).toHaveAttribute('aria-current', 'page');
    const pluginGroup = await screen.findByRole('button', { name: 'core.navigation.pluginWebui' });
    expect(pluginGroup).toHaveAttribute('aria-expanded', 'false');

    await user.click(pluginGroup);
    expect(pluginGroup).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: 'Example plugin' })).toHaveAttribute(
      'href',
      '/plugin-page/example/settings',
    );

    const resizeHandle = screen.getByRole('separator', { name: 'core.navigation.resize' });
    await user.type(resizeHandle, '{ArrowRight}');
    await waitFor(() => expect(resizeHandle).toHaveAttribute('aria-valuenow', String(SIDEBAR_DEFAULT_WIDTH + 10)));
    await user.type(resizeHandle, '{End}');
    expect(resizeHandle).toHaveAttribute('aria-valuenow', '300');
  });

  it('closes the mobile drawer through the accessible backdrop action', async () => {
    const user = userEvent.setup();
    openapiMock.listPlugins.mockResolvedValue(mockApiResponse([]));
    renderRoute(<Sidebar />);

    await user.click(screen.getByRole('button', { name: 'core.common.close' }));

    expect(useLayoutStore.getState().drawerOpen).toBe(false);
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });
});

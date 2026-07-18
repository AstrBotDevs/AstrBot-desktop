// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SIDEBAR_DEFAULT_WIDTH, useLayoutStore } from '@/stores/layout';
import { mockApiResponse, renderRoute } from '@/test/render';
import { Sidebar } from './Sidebar';

const openapiMock = vi.hoisted(() => ({ listPlugins: vi.fn() }));

vi.mock('@/api/openapi', () => ({ listPlugins: openapiMock.listPlugins }));

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
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
    });
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

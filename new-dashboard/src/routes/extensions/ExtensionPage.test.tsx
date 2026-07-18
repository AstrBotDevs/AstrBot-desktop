// @vitest-environment jsdom

import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { listFailedPlugins, listPlugins, setPluginEnabledById } from '@/api/openapi';
import { deferred } from '@/test/async';
import { mockApiResponse, renderRoute } from '@/test/render';
import ExtensionPage from './ExtensionPage';

vi.mock('@/api/openapi');
vi.mock('./ExtensionSections', () => ({
  ComponentsSection: () => <div>components</div>,
  McpSection: () => <div>mcp</div>,
  SkillsSection: () => <div>skills</div>,
}));
const plugins = (items: unknown[]) => mockApiResponse({ plugins: items });

describe('ExtensionPage', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listFailedPlugins).mockResolvedValue(plugins([]));
  });

  it('renders loading and the installed plugin list', async () => {
    const user = userEvent.setup();
    const request = deferred<Awaited<ReturnType<typeof listPlugins<false>>>>();
    vi.mocked(listPlugins).mockReturnValue(request.promise);

    renderRoute(<ExtensionPage />, { route: '/extension' });
    expect(screen.getByRole('status', { name: 'features.extension.status.loading' })).toBeInTheDocument();
    request.resolve(
      plugins([
        { activated: true, display_name: 'Calendar', name: 'calendar', version: '1.0.0' },
        { activated: true, display_name: 'Weather', name: 'weather', version: '1.0.0' },
      ]),
    );

    expect(await screen.findByText('Calendar')).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText('features.extension.search.placeholder'), 'weather');
    expect(screen.queryByText('Calendar')).not.toBeInTheDocument();
    expect(screen.getByText('Weather')).toBeInTheDocument();
  });

  it('shows a page-level error when installed plugins cannot load', async () => {
    vi.mocked(listPlugins).mockRejectedValue(new Error('plugin service unavailable'));

    renderRoute(<ExtensionPage />, { route: '/extension' });

    expect(await screen.findByRole('alert')).toHaveTextContent('plugin service unavailable');
  });

  it('toggles an installed plugin and refreshes the list', async () => {
    const user = userEvent.setup();
    vi.mocked(listPlugins).mockResolvedValue(
      plugins([{ activated: true, display_name: 'Calendar', name: 'calendar', version: '1.0.0' }]),
    );
    vi.mocked(setPluginEnabledById).mockResolvedValue(mockApiResponse({}));

    renderRoute(<ExtensionPage />, { route: '/extension' });
    await user.click(await screen.findByRole('checkbox'));

    await waitFor(() =>
      expect(setPluginEnabledById).toHaveBeenCalledWith({
        body: { enabled: false, plugin_id: 'calendar' },
      }),
    );
    expect(vi.mocked(listPlugins).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

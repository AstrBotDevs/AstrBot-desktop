// @vitest-environment jsdom

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useLayoutStore } from '@/stores/layout';
import { renderRoute } from '@/test/render';
import { SettingsDialog } from './SettingsDialog';

vi.mock('@/routes/configuration/SettingsPage', () => ({
  default: ({ embedded, initialSection }: { embedded?: boolean; initialSection?: string }) => (
    <div data-embedded={String(embedded)} data-section={initialSection}>
      Settings content
    </div>
  ),
}));

describe('SettingsDialog', () => {
  beforeEach(() => useLayoutStore.setState({ settingsOpen: false, settingsSection: 'general' }));

  it('renders the requested section and closes through the dialog action', async () => {
    const user = userEvent.setup();
    useLayoutStore.setState({ settingsOpen: true, settingsSection: 'network' });
    renderRoute(<SettingsDialog />);

    const dialog = await screen.findByRole('dialog');
    const content = await within(dialog).findByText('Settings content');
    expect(content).toHaveAttribute('data-embedded', 'true');
    expect(content).toHaveAttribute('data-section', 'network');

    await user.click(within(dialog).getByRole('button', { name: 'core.common.close' }));
    await waitFor(() => expect(useLayoutStore.getState().settingsOpen).toBe(false));
  });
});

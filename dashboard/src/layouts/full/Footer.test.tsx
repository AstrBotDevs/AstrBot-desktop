// @vitest-environment jsdom

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderRoute } from '@/test/render';
import { Footer } from './Footer';

vi.mock('@/routes/monitoring/ConsolePage', () => ({
  default: () => <div>Console panel</div>,
}));

describe('Footer', () => {
  it('opens platform logs in a dialog without navigating', async () => {
    const user = userEvent.setup();
    renderRoute(<Footer />, { route: '/welcome' });

    const trigger = screen.getByRole('button', { name: 'core.navigation.console' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');

    await user.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Console panel')).toBeInTheDocument();
    expect(window.location.hash).toBe('');

    await user.click(within(dialog).getByRole('button', { name: 'core.common.close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

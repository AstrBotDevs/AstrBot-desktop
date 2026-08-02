// @vitest-environment jsdom

import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderRoute } from '@/test/render';
import { Footer } from './Footer';

vi.mock('@/routes/monitoring/ConsolePage', () => ({
  default: () => <div>Console panel</div>,
}));
vi.mock('@/routes/monitoring/ConversationPage', () => ({ default: () => <div>Conversation panel</div> }));
vi.mock('@/routes/monitoring/SessionManagementPage', () => ({ default: () => <div>Rules panel</div> }));
vi.mock('@/routes/monitoring/StatsPage', () => ({ default: () => <div>Stats panel</div> }));
vi.mock('@/routes/monitoring/TracePage', () => ({ default: () => <div>Trace panel</div> }));

describe('Footer', () => {
  it('opens monitoring pages in dialogs without navigating', async () => {
    const user = userEvent.setup();
    renderRoute(<Footer />, { route: '/welcome' });

    const triggers = [
      'core.navigation.conversation',
      'core.navigation.sessionManagement',
      'core.navigation.dashboard',
      'core.navigation.trace',
    ];
    triggers.forEach((name) => expect(screen.getByRole('button', { name })).toHaveAttribute('aria-haspopup', 'dialog'));

    await user.click(screen.getByRole('button', { name: 'core.navigation.conversation' }));
    expect(await screen.findByText('Conversation panel')).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

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

// @vitest-environment jsdom

import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';

import { renderRoute } from '@/test/render';
import { toast, type ToastVariant, useFeedbackStore } from '@/stores/feedback';
import { GlobalFeedback } from './GlobalFeedback';

const variants: Array<{ icon: string; role: 'alert' | 'status'; variant: ToastVariant }> = [
  { icon: 'mdi-check-circle-outline', role: 'status', variant: 'success' },
  { icon: 'mdi-information-outline', role: 'status', variant: 'info' },
  { icon: 'mdi-alert-outline', role: 'status', variant: 'warning' },
  { icon: 'mdi-alert-circle-outline', role: 'alert', variant: 'error' },
];

describe('GlobalFeedback toast', () => {
  beforeEach(() => useFeedbackStore.setState({ toasts: [] }));

  it.each(variants)('renders the $variant snackbar color class and icon', ({ icon, role, variant }) => {
    toast('Operation result', { timeout: 0, variant });

    const { container } = renderRoute(<GlobalFeedback />);

    expect(screen.getByRole(role)).toHaveClass(`global-toast--${variant}`);
    expect(container.querySelector(`.${icon}`)).toBeInTheDocument();
  });

  it('dismisses a closable snackbar', async () => {
    const user = userEvent.setup();
    toast.info('Nothing to update');
    renderRoute(<GlobalFeedback />);

    await user.click(screen.getByRole('button', { name: 'Close notification' }));

    expect(screen.queryByText('Nothing to update')).not.toBeInTheDocument();
  });
});

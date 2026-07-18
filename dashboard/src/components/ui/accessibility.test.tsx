// @vitest-environment jsdom

import axe from 'axe-core';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { GlobalFeedback } from '@/components/feedback/GlobalFeedback';
import { confirmWarningAction } from './confirm';
import { DataTable } from './DataTable';
import { Pagination } from './Pagination';
import { SearchField } from './SearchField';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

const translate = vi.hoisted(() => (key: string) => key);

async function expectNoSeriousViolations(container: Element) {
  const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
  expect(result.violations.filter((violation) => ['critical', 'serious'].includes(violation.impact ?? ''))).toEqual([]);
}

describe('shared UI accessibility', () => {
  it('passes automated accessibility checks and keyboard activation', async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const view = render(
      <main>
        <SearchField clearLabel="Clear search" label="Search plugins" onChange={() => undefined} value="calendar" />
        <DataTable
          columns={[{ header: 'Name', id: 'name', render: (item: { name: string }) => item.name }]}
          empty={{ title: 'No plugins' }}
          getRowKey={(item) => item.name}
          loadingLabel="Loading plugins"
          rows={[{ name: 'Calendar' }]}
        />
        <Pagination
          labels={{ navigation: 'Plugin pages', next: 'Next page', previous: 'Previous page' }}
          onPageChange={onPageChange}
          page={1}
          pageSize={20}
          totalItems={45}
        />
      </main>,
    );

    const next = screen.getByRole('button', { name: 'Next page' });
    next.focus();
    await user.keyboard('{Enter}');
    expect(onPageChange).toHaveBeenCalledWith(2);
    await expectNoSeriousViolations(view.container);
  });

  it('traps focus in confirmation dialogs and restores it after Escape', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Origin</button>
        <GlobalFeedback />
      </>,
    );
    const origin = screen.getByRole('button', { name: 'Origin' });
    origin.focus();
    const confirmation = confirmWarningAction('Discard changes?');

    const dialog = await screen.findByRole('dialog');
    const cancel = screen.getByRole('button', { name: 'core.common.cancel' });
    const confirm = screen.getByRole('button', { name: 'core.common.confirm' });
    await waitFor(() => expect(cancel).toHaveFocus());
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await expectNoSeriousViolations(dialog);
    await user.keyboard('{Escape}');

    await expect(confirmation).resolves.toBe(false);
    await waitFor(() => expect(origin).toHaveFocus());
  });
});

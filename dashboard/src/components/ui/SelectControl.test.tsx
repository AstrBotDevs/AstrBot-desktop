// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ChangeEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SelectControl } from './SelectControl';

describe('SelectControl', () => {
  it('preserves native change handlers while using the shared menu', async () => {
    const user = userEvent.setup();
    let changedValue = '';
    const onChange = vi.fn((event: ChangeEvent<HTMLSelectElement>) => {
      changedValue = event.target.value;
    });
    render(
      <SelectControl aria-label="Page size" onChange={onChange} value="10">
        <option value="10">10</option>
        <option value="20">20</option>
      </SelectControl>,
    );

    await user.click(screen.getByRole('button', { name: 'Page size' }));
    await user.click(screen.getByRole('option', { name: '20' }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(changedValue).toBe('20');
  });
});

// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
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
    const view = render(
      <SelectControl aria-label="Page size" onChange={onChange} value="10">
        <option value="10">10</option>
        <option value="20">20</option>
      </SelectControl>,
    );

    await user.click(screen.getByRole('button', { name: 'Page size' }));
    expect(view.container.querySelector('[role="listbox"]')).toBeNull();
    expect(document.body.querySelector('[role="listbox"]')).not.toBeNull();
    await user.click(screen.getByRole('option', { name: '20' }));

    expect(onChange).toHaveBeenCalledOnce();
    expect(changedValue).toBe('20');
  });

  it('opens above the trigger when the viewport has no room below', async () => {
    const user = userEvent.setup();
    render(
      <SelectControl aria-label="Page size" onChange={() => undefined} value="10">
        <option value="10">10</option>
        <option value="20">20</option>
      </SelectControl>,
    );
    const trigger = screen.getByRole('button', { name: 'Page size' });
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      bottom: 764,
      height: 44,
      left: 100,
      right: 220,
      top: 720,
      width: 120,
      x: 100,
      y: 720,
      toJSON: () => ({}),
    });

    await user.click(trigger);

    const listbox = screen.getByRole('listbox', { name: 'Page size' });
    await waitFor(() => expect(listbox.style.bottom).not.toBe(''));
    expect(listbox.style.top).toBe('');
  });
});

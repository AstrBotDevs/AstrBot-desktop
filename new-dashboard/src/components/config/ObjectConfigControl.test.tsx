// @vitest-environment jsdom

import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderRoute } from '@/test/render';
import { ObjectConfigControl } from './ObjectConfigControl';

describe('ObjectConfigControl', () => {
  it('edits existing values and adds typed values through the dialog', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderRoute(<ObjectConfigControl metadata={{}} onChange={onChange} value={{ existing: 'before' }} />);

    await user.click(screen.getByRole('button', { name: 'core.common.list.modifyButton' }));
    const existingValue = screen.getByPlaceholderText('core.common.objectEditor.placeholders.stringValue');
    await user.clear(existingValue);
    await user.type(existingValue, 'after');
    await user.type(screen.getByPlaceholderText('core.common.objectEditor.newKeyLabel'), 'retries');
    await user.selectOptions(screen.getByRole('combobox'), 'number');
    await user.click(screen.getByRole('button', { name: /core\.common\.add/ }));

    const numberValue = screen.getByPlaceholderText('core.common.objectEditor.placeholders.numberValue');
    await user.clear(numberValue);
    await user.type(numberValue, '3');
    await user.click(screen.getByRole('button', { name: 'core.common.confirm' }));

    expect(onChange).toHaveBeenCalledWith({ existing: 'after', retries: 3 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open and marks malformed JSON as invalid', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    renderRoute(<ObjectConfigControl metadata={{}} onChange={onChange} value={{ payload: { enabled: true } }} />);

    await user.click(screen.getByRole('button', { name: 'core.common.list.modifyButton' }));
    const jsonValue = screen.getByPlaceholderText('core.common.objectEditor.placeholders.jsonValue');
    fireEvent.change(jsonValue, { target: { value: '{broken' } });
    await user.click(screen.getByRole('button', { name: 'core.common.confirm' }));

    expect(onChange).not.toHaveBeenCalled();
    expect(jsonValue).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('core.common.objectEditor.invalidJson')).toBeInTheDocument();
  });

  it('does not expose the manage action while disabled', () => {
    renderRoute(<ObjectConfigControl disabled metadata={{}} onChange={vi.fn()} value={{}} />);

    expect(screen.queryByRole('button', { name: 'core.common.list.modifyButton' })).not.toBeInTheDocument();
  });
});

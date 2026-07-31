// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FloatingActionButton, FloatingActions } from './FloatingActions';

describe('FloatingActions', () => {
  it('portals actions to the document body with shared classes', () => {
    render(
      <main>
        <FloatingActions aria-label="Page actions">
          <FloatingActionButton aria-label="Refresh">Refresh</FloatingActionButton>
        </FloatingActions>
      </main>,
    );

    const action = screen.getByRole('button', { name: 'Refresh' });
    const stack = screen.getByLabelText('Page actions');

    expect(action).toHaveClass('ui-floating-action');
    expect(action).toHaveAttribute('type', 'button');
    expect(stack).toHaveClass('ui-floating-actions');
    expect(stack.parentElement).toBe(document.body);
  });
});

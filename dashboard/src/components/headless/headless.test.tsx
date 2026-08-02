// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Dialog } from './Dialog';
import { getNextMenuItemIndex, Menu, MenuItem } from './Menu';
import { Popover } from './Popover';

describe('headless interaction primitives', () => {
  it('calculates wrapping keyboard navigation for menu items', () => {
    expect(getNextMenuItemIndex('ArrowDown', 2, 3)).toBe(0);
    expect(getNextMenuItemIndex('ArrowUp', 0, 3)).toBe(2);
    expect(getNextMenuItemIndex('Home', 2, 3)).toBe(0);
    expect(getNextMenuItemIndex('End', 0, 3)).toBe(2);
    expect(getNextMenuItemIndex('Enter', 0, 3)).toBeNull();
  });

  it('exposes accessible trigger state for menus and popovers', () => {
    const menu = renderToStaticMarkup(
      <Menu label="Actions" trigger={(props) => <button {...props}>Open</button>}>
        <MenuItem>Item</MenuItem>
      </Menu>,
    );
    const popover = renderToStaticMarkup(
      <Popover label="Details" trigger={(props) => <button {...props}>Open</button>}>
        Details
      </Popover>,
    );
    const dialog = renderToStaticMarkup(
      <Dialog title="Confirm" trigger={<button>Open</button>}>
        Dialog content
      </Dialog>,
    );

    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain('aria-expanded="false"');
    expect(popover).toContain('aria-haspopup="dialog"');
    expect(popover).toContain('aria-expanded="false"');
    expect(dialog).toContain('aria-haspopup="dialog"');
    expect(dialog).toContain('data-state="closed"');
  });

  it('wraps each open dialog in an independent stacking layer', () => {
    const { container } = render(
      <Dialog open title="First dialog">
        First content
      </Dialog>,
    );

    const dialog = document.querySelector('.headless-dialog__content');
    const layer = dialog?.parentElement;

    expect(container).toBeEmptyDOMElement();
    expect(layer).toHaveClass('headless-dialog__layer');
    expect(layer?.querySelector('.headless-dialog__overlay')).not.toBeNull();
  });
});

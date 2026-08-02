// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AutoHideScrollbars } from './AutoHideScrollbars';

describe('AutoHideScrollbars', () => {
  afterEach(() => {
    vi.useRealTimers();
    document.documentElement.classList.remove('auto-hide-scrollbars');
  });

  it('shows the active scrollbar while scrolling and hides it after a delay', () => {
    vi.useFakeTimers();
    const scrollArea = document.createElement('div');
    document.body.append(scrollArea);
    const view = render(<AutoHideScrollbars />);

    expect(document.documentElement).toHaveClass('auto-hide-scrollbars');
    scrollArea.dispatchEvent(new Event('scroll'));
    expect(scrollArea).toHaveAttribute('data-scrollbar-active', 'true');

    vi.advanceTimersByTime(699);
    expect(scrollArea).toHaveAttribute('data-scrollbar-active', 'true');
    vi.advanceTimersByTime(1);
    expect(scrollArea).not.toHaveAttribute('data-scrollbar-active');

    view.unmount();
    expect(document.documentElement).not.toHaveClass('auto-hide-scrollbars');
    scrollArea.remove();
  });
});

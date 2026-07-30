// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useDesktopStore } from '@/stores/desktop';
import { Header } from './Header';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { changeLanguage: vi.fn(), language: 'zh-CN' },
    t: (key: string) => key,
  }),
}));

vi.mock('@/desktop/DesktopProvider', () => ({
  useDesktop: () => ({ checkForUpdate: vi.fn(), installUpdate: vi.fn() }),
}));

describe('desktop header', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    useDesktopStore.setState({ isDesktop: false, runtimeChecked: false });
  });

  it('does not expose account or password controls', () => {
    useDesktopStore.setState({ isDesktop: true, runtimeChecked: true });

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByLabelText('core.header.buttons.menu'));
    expect(screen.getByText('core.common.language')).toBeInTheDocument();
    expect(screen.getByText('core.header.buttons.theme.title')).toBeInTheDocument();
    expect(screen.getByText('core.header.updateDialog.title')).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
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

  it('keeps the application menu out of the header', () => {
    useDesktopStore.setState({ isDesktop: true, runtimeChecked: true });

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    expect(screen.queryByLabelText('core.header.buttons.menu')).not.toBeInTheDocument();
  });

  it('keeps the shared Bot header on chat routes', () => {
    render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Header />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /AstrBot/i })).toHaveAttribute('href', '/about');
    expect(screen.getByRole('button', { name: 'core.header.buttons.collapseSidebar' })).toBeInTheDocument();
  });
});

// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { statsApi } from '@/api/compat';
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

describe('desktop header account controls', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    useDesktopStore.setState({ isDesktop: false, runtimeChecked: false });
  });

  it('does not show password warnings or request password status in desktop mode', () => {
    window.localStorage.setItem('change_pwd_hint', 'true');
    useDesktopStore.setState({ isDesktop: true, runtimeChecked: true });
    const version = vi.spyOn(statsApi, 'version');

    render(
      <MemoryRouter>
        <Header />
      </MemoryRouter>,
    );

    expect(screen.queryByText('core.header.accountDialog.title')).not.toBeInTheDocument();
    expect(screen.queryByText('core.header.accountDialog.form.currentPassword')).not.toBeInTheDocument();
    expect(version).not.toHaveBeenCalled();
    expect(window.localStorage.getItem('change_pwd_hint')).toBeNull();
  });
});

// @vitest-environment jsdom

import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/auth';
import { useDesktopStore } from '@/stores/desktop';
import { DesktopAuthGate } from './DesktopAuthGate';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('DesktopAuthGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    act(() => {
      useAuthStore.setState({ hasToken: false, username: '' });
      useDesktopStore.setState({ isDesktop: false, runtimeChecked: false });
    });
  });

  it('starts a passwordless session before rendering the managed desktop UI', async () => {
    const getAuthSession = vi.fn().mockResolvedValue({
      ok: true,
      token: 'desktop-token',
      username: 'astrbot',
    });
    window.astrbotDesktop = {
      getAuthSession,
      isDesktop: true,
    } as unknown as AstrBotDesktopBridge;
    act(() => {
      useDesktopStore.setState({ isDesktop: true, runtimeChecked: true });
    });

    render(
      <DesktopAuthGate>
        <span>desktop content</span>
      </DesktopAuthGate>,
    );

    expect(await screen.findByText('desktop content')).toBeInTheDocument();
    expect(getAuthSession).toHaveBeenCalledOnce();
    expect(useAuthStore.getState()).toMatchObject({ hasToken: true, username: 'astrbot' });
  });

  it('does not request a desktop session in the browser dashboard', async () => {
    const getAuthSession = vi.fn();
    window.astrbotDesktop = {
      getAuthSession,
      isDesktop: true,
    } as unknown as AstrBotDesktopBridge;
    act(() => {
      useDesktopStore.setState({ isDesktop: false, runtimeChecked: true });
    });

    render(
      <DesktopAuthGate>
        <span>browser content</span>
      </DesktopAuthGate>,
    );

    expect(await screen.findByText('browser content')).toBeInTheDocument();
    expect(getAuthSession).not.toHaveBeenCalled();
  });
});

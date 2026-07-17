import { type ReactNode, useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';

import { subscribeToExpiredSession } from '@/auth/sessionEvents';
import { i18n } from '@/i18n';
import { GlobalFeedback } from '@/components/feedback/GlobalFeedback';
import { UpgradeRecoveryDialog } from '@/components/feedback/UpgradeRecoveryDialog';
import { DesktopProvider, DesktopRestartStatus } from '@/desktop/DesktopProvider';
import { useAuthStore } from '@/stores/auth';
import { useLayoutStore } from '@/stores/layout';

function LayoutEffects() {
  const themeMode = useLayoutStore((state) => state.themeMode);
  const setThemeMode = useLayoutStore((state) => state.setThemeMode);

  useEffect(() => {
    setThemeMode(themeMode);
    if (themeMode !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setThemeMode('system');
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [setThemeMode, themeMode]);

  return null;
}

function AuthSessionEffects() {
  const clearSession = useAuthStore((state) => state.clearSession);

  useEffect(() => subscribeToExpiredSession(clearSession), [clearSession]);

  return null;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      <LayoutEffects />
      <AuthSessionEffects />
      <DesktopProvider>
        {children}
        <DesktopRestartStatus />
        <UpgradeRecoveryDialog />
        <GlobalFeedback />
      </DesktopProvider>
    </I18nextProvider>
  );
}

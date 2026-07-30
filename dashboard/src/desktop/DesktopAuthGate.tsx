import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useAuthStore } from '@/stores/auth';
import { useDesktopStore } from '@/stores/desktop';

type DesktopAuthStatus = 'waiting' | 'ready' | 'error';

export function DesktopAuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const finishSession = useAuthStore((state) => state.finishSession);
  const hasToken = useAuthStore((state) => state.hasToken);
  const isDesktop = useDesktopStore((state) => state.isDesktop);
  const runtimeChecked = useDesktopStore((state) => state.runtimeChecked);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<DesktopAuthStatus>('waiting');

  useEffect(() => {
    if (!runtimeChecked) return;
    if (!isDesktop || hasToken) {
      setStatus('ready');
      return;
    }

    let active = true;
    setStatus('waiting');
    const bridge = globalThis.window?.astrbotDesktop;
    if (!bridge?.getAuthSession) {
      setStatus('error');
      return;
    }
    void bridge
      .getAuthSession()
      .then((response) => {
        if (!active) return;
        if (!response.ok || !response.token || !response.username) {
          throw new Error(response.reason || 'Desktop authentication failed.');
        }
        finishSession({ token: response.token, username: response.username });
        setStatus('ready');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [attempt, finishSession, hasToken, isDesktop, runtimeChecked]);

  if (status === 'ready') return children;

  return (
    <main className="app-bootstrap" aria-live="polite" role="status">
      {status === 'waiting' ? (
        <>
          <span className="app-bootstrap__spinner" aria-hidden="true" />
          <p>{t('core.common.bootstrap.starting')}</p>
        </>
      ) : (
        <>
          <p role="alert">{t('core.common.bootstrap.desktopAuthFailed')}</p>
          <button className="app-bootstrap__retry" type="button" onClick={() => setAttempt((value) => value + 1)}>
            {t('core.common.bootstrap.retry')}
          </button>
        </>
      )}
    </main>
  );
}

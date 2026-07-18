import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import App from '@/App';
import { waitForDesktopBackendReady } from '@/desktop/readiness';
import { detectDesktopRuntime } from '@/desktop/runtime';

type BootstrapStatus = 'waiting' | 'ready' | 'error';

export function AppBootstrap() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<BootstrapStatus>('waiting');
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setStatus('waiting');
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let active = true;

    void detectDesktopRuntime().then(async (runtime) => {
      const ready =
        !runtime.isDesktop || !runtime.bridge ? true : await waitForDesktopBackendReady({ bridge: runtime.bridge });
      if (active) setStatus(ready ? 'ready' : 'error');
    });

    return () => {
      active = false;
    };
  }, [attempt]);

  if (status === 'ready') return <App />;

  return (
    <main className="app-bootstrap" aria-live="polite" role="status">
      <div className="app-bootstrap__brand" aria-hidden="true">
        <span className="mdi mdi-creation" />
        <span>AstrBot</span>
      </div>
      {status === 'waiting' ? (
        <>
          <span className="app-bootstrap__spinner" aria-hidden="true" />
          <p>{t('core.common.bootstrap.starting')}</p>
        </>
      ) : (
        <>
          <p role="alert">{t('core.common.bootstrap.timeout')}</p>
          <button className="app-bootstrap__retry" type="button" onClick={retry}>
            {t('core.common.bootstrap.retry')}
          </button>
        </>
      )}
    </main>
  );
}

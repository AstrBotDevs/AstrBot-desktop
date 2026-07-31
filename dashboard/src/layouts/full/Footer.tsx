import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';

const ConsolePanel = lazy(() => import('@/routes/monitoring/ConsolePage'));

export function Footer() {
  const { t } = useTranslation();
  const consoleLabel = t('core.navigation.console');

  return (
    <div className="app-footer__items">
      <Dialog
        title={consoleLabel}
        trigger={
          <button aria-label={consoleLabel} className="app-footer__item" data-tooltip={consoleLabel} type="button">
            <MdiIcon name="mdi-console" />
          </button>
        }
      >
        <div className="console-dialog">
          <Suspense
            fallback={
              <div className="monitor-loading" role="status">
                {t('core.common.loading')}
              </div>
            }
          >
            <ConsolePanel />
          </Suspense>
        </div>
        <DialogClose asChild>
          <button aria-label={t('core.common.close')} className="console-dialog-close" type="button">
            <MdiIcon name="mdi-close" />
          </button>
        </DialogClose>
      </Dialog>
    </div>
  );
}

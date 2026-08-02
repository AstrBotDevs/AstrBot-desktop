import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';

const ConsolePanel = lazy(() => import('@/routes/monitoring/ConsolePage'));
const ConversationPanel = lazy(() => import('@/routes/monitoring/ConversationPage'));
const SessionManagementPanel = lazy(() => import('@/routes/monitoring/SessionManagementPage'));
const StatsPanel = lazy(() => import('@/routes/monitoring/StatsPage'));
const TracePanel = lazy(() => import('@/routes/monitoring/TracePage'));

const footerNavigationItems = [
  { title: 'core.navigation.conversation', icon: 'mdi-database', panel: ConversationPanel },
  { title: 'core.navigation.sessionManagement', icon: 'mdi-pencil-ruler', panel: SessionManagementPanel },
  { title: 'core.navigation.dashboard', icon: 'mdi-view-dashboard', panel: StatsPanel },
  { title: 'core.navigation.trace', icon: 'mdi-timeline-text-outline', panel: TracePanel },
] as const;

export function Footer() {
  const { t } = useTranslation();
  const consoleLabel = t('core.navigation.console');

  return (
    <div className="app-footer__items">
      {footerNavigationItems.map((item) => {
        const label = t(item.title);
        const Panel = item.panel;
        return (
          <Dialog
            key={item.title}
            title={label}
            trigger={
              <button aria-label={label} className="app-footer__item" data-tooltip={label} type="button">
                <MdiIcon name={item.icon} />
              </button>
            }
          >
            <div className="footer-navigation-dialog">
              <Suspense
                fallback={
                  <div className="monitor-loading" role="status">
                    {t('core.common.loading')}
                  </div>
                }
              >
                <Panel />
              </Suspense>
            </div>
            <DialogClose asChild>
              <button aria-label={t('core.common.close')} className="footer-navigation-dialog__close" type="button">
                <MdiIcon name="mdi-close" />
              </button>
            </DialogClose>
          </Dialog>
        );
      })}
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

import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';

import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';

const ConsolePanel = lazy(() => import('@/routes/monitoring/ConsolePage'));

const footerNavigationItems = [
  { title: 'core.navigation.conversation', icon: 'mdi-database', to: '/conversation' },
  { title: 'core.navigation.sessionManagement', icon: 'mdi-pencil-ruler', to: '/session-management' },
  { title: 'core.navigation.dashboard', icon: 'mdi-view-dashboard', to: '/dashboard/default' },
  { title: 'core.navigation.trace', icon: 'mdi-timeline-text-outline', to: '/trace' },
] as const;

export function Footer() {
  const { t } = useTranslation();
  const consoleLabel = t('core.navigation.console');

  return (
    <div className="app-footer__items">
      {footerNavigationItems.map((item) => {
        const label = t(item.title);
        return (
          <NavLink
            aria-label={label}
            className={({ isActive }) => `app-footer__item${isActive ? ' app-footer__item--active' : ''}`}
            data-tooltip={label}
            key={item.to}
            to={item.to}
          >
            <MdiIcon name={item.icon} />
          </NavLink>
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

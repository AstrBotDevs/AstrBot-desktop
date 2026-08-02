import { lazy, Suspense, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';

const ConsolePanel = lazy(() => import('@/routes/monitoring/ConsolePage'));
const ConversationPanel = lazy(() => import('@/routes/monitoring/ConversationPage'));
const SessionManagementPanel = lazy(() => import('@/routes/monitoring/SessionManagementPage'));
const StatsPanel = lazy(() => import('@/routes/monitoring/StatsPage'));
const TracePanel = lazy(() => import('@/routes/monitoring/TracePage'));

const footerItems = [
  { title: 'core.navigation.conversation', icon: 'mdi-database', panel: ConversationPanel },
  { title: 'core.navigation.sessionManagement', icon: 'mdi-pencil-ruler', panel: SessionManagementPanel },
  { title: 'core.navigation.dashboard', icon: 'mdi-view-dashboard', panel: StatsPanel },
  { title: 'core.navigation.trace', icon: 'mdi-timeline-text-outline', panel: TracePanel },
  { title: 'core.navigation.console', icon: 'mdi-console', panel: ConsolePanel, showTitle: true },
] as const;

function FooterPanelDialog({
  children,
  closeLabel,
  icon,
  label,
  loadingLabel,
  showTitle = false,
}: {
  children: ReactNode;
  closeLabel: string;
  icon: `mdi-${string}`;
  label: string;
  loadingLabel: string;
  showTitle?: boolean;
}) {
  return (
    <Dialog
      title={label}
      trigger={
        <button aria-label={label} className="app-footer__item" data-tooltip={label} type="button">
          <MdiIcon name={icon} />
        </button>
      }
    >
      <div
        className={`footer-panel-dialog${showTitle ? ' footer-panel-dialog--console' : ' footer-panel-dialog--page'}`}
      >
        <Suspense
          fallback={
            <div className="monitor-loading" role="status">
              {loadingLabel}
            </div>
          }
        >
          {children}
        </Suspense>
      </div>
      <DialogClose asChild>
        <button aria-label={closeLabel} className="footer-panel-dialog__close" type="button">
          <MdiIcon name="mdi-close" />
        </button>
      </DialogClose>
    </Dialog>
  );
}

export function Footer() {
  const { t } = useTranslation();
  const closeLabel = t('core.common.close');
  const loadingLabel = t('core.common.loading');

  return (
    <div className="app-footer__items">
      {footerItems.map((item) => {
        const label = t(item.title);
        const Panel = item.panel;
        return (
          <FooterPanelDialog
            closeLabel={closeLabel}
            icon={item.icon}
            key={item.title}
            label={label}
            loadingLabel={loadingLabel}
            showTitle={'showTitle' in item && item.showTitle}
          >
            <Panel />
          </FooterPanelDialog>
        );
      })}
    </div>
  );
}

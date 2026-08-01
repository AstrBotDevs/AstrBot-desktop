import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { useLayoutStore } from '@/stores/layout';

const SettingsPage = lazy(() => import('@/routes/configuration/SettingsPage'));

export function SettingsDialog() {
  const { t } = useTranslation();
  const open = useLayoutStore((state) => state.settingsOpen);
  const section = useLayoutStore((state) => state.settingsSection);
  const closeSettings = useLayoutStore((state) => state.closeSettings);

  return (
    <Dialog
      onOpenChange={(nextOpen) => !nextOpen && closeSettings()}
      open={open}
      title={t('features.settings.page.title')}
    >
      <div className="settings-dialog">
        <Suspense
          fallback={
            <div className="route-loading" role="status">
              {t('core.common.loading')}
            </div>
          }
        >
          <SettingsPage embedded initialSection={section} />
        </Suspense>
      </div>
      <DialogClose asChild>
        <button aria-label={t('core.common.close')} className="settings-dialog__close" type="button">
          <MdiIcon name="mdi-close" />
        </button>
      </DialogClose>
    </Dialog>
  );
}

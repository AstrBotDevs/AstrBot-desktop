import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { Button, DialogCancel } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { useFeedbackStore } from '@/stores/feedback';

function LoadingIndicator() {
  const active = useFeedbackStore((state) => state.loadingIds.size > 0);
  const progress = useFeedbackStore((state) => state.loadingProgress);
  if (!active) return null;
  return (
    <div
      aria-label="Loading"
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={progress ?? undefined}
      className={`global-loading${progress == null ? ' global-loading--indeterminate' : ''}`}
      role="progressbar"
    >
      <div
        className="global-loading__bar"
        style={progress == null ? undefined : { transform: `scaleX(${progress / 100})` }}
      />
    </div>
  );
}

function ToastViewport() {
  const current = useFeedbackStore((state) => state.toasts[0]);
  const dismiss = useFeedbackStore((state) => state.dismissToast);
  useEffect(() => {
    if (!current || current.timeout <= 0) return;
    const timer = window.setTimeout(() => dismiss(current.id), current.timeout);
    return () => window.clearTimeout(timer);
  }, [current, dismiss]);
  if (!current) return <div aria-live="polite" className="toast-viewport" />;
  return (
    <div aria-live={current.variant === 'error' ? 'assertive' : 'polite'} className="toast-viewport">
      <div
        className={`global-toast global-toast--${current.variant}`}
        role={current.variant === 'error' ? 'alert' : 'status'}
      >
        <span>{current.message}</span>
        {current.closable && (
          <button aria-label="Close notification" onClick={() => dismiss(current.id)} type="button">
            ×
          </button>
        )}
      </div>
    </div>
  );
}

function ConfirmHost() {
  const { t } = useTranslation();
  const current = useFeedbackStore((state) => state.confirmQueue[0]);
  const resolve = useFeedbackStore((state) => state.resolveConfirmation);
  if (!current) return null;
  return (
    <Dialog
      description={current.message}
      onOpenChange={(open) => {
        if (!open) resolve(current.id, false);
      }}
      open
      title={current.title ?? t('core.common.confirm')}
    >
      <DialogActions className="global-confirm__actions">
        <DialogCancel onClick={() => resolve(current.id, false)}>
          {current.cancelLabel ?? t('core.common.cancel')}
        </DialogCancel>
        <DialogClose asChild>
          <Button onClick={() => resolve(current.id, true)} variant={current.danger ? 'danger' : 'primary'}>
            {current.confirmLabel ?? t('core.common.confirm')}
          </Button>
        </DialogClose>
      </DialogActions>
    </Dialog>
  );
}

export function GlobalFeedback() {
  return (
    <>
      <LoadingIndicator />
      <ToastViewport />
      <ConfirmHost />
    </>
  );
}

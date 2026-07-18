import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Dialog, DialogClose } from '@/components/headless/Dialog';
import { MdiIcon } from '@/components/icons/MdiIcon';
import { Button, DialogCancel } from '@/components/ui/Button';
import { DialogActions } from '@/components/ui/DialogActions';
import { type ToastVariant, useFeedbackStore } from '@/stores/feedback';

const toastIcons: Record<ToastVariant, `mdi-${string}`> = {
  error: 'mdi-alert-circle-outline',
  info: 'mdi-information-outline',
  success: 'mdi-check-circle-outline',
  warning: 'mdi-alert-outline',
};

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
        <div className="global-toast__message">
          <MdiIcon className="global-toast__icon" name={toastIcons[current.variant]} size={24} />
          <span>{current.message}</span>
        </div>
        {current.closable && (
          <button
            aria-label="Close notification"
            className="global-toast__close"
            onClick={() => dismiss(current.id)}
            type="button"
          >
            <MdiIcon name="mdi-close" size={20} />
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
  const returnFocus = useRef<HTMLElement | null>(null);
  if (!current) return null;
  if (!returnFocus.current && typeof document !== 'undefined' && document.activeElement instanceof HTMLElement)
    returnFocus.current = document.activeElement;
  const resolveCurrent = (confirmed: boolean) => {
    const target = returnFocus.current;
    returnFocus.current = null;
    resolve(current.id, confirmed);
    window.queueMicrotask(() => target?.focus());
  };
  const title =
    current.title ?? (current.intent === 'warning' ? t('core.common.warning') : t('core.common.dialog.confirmTitle'));
  const confirmVariant =
    current.intent === 'destructive' ? 'danger' : current.intent === 'warning' ? 'warning' : 'primary';
  return (
    <Dialog
      description={current.message}
      onOpenChange={(open) => {
        if (!open) resolveCurrent(false);
      }}
      open
      title={title}
    >
      <DialogActions className="global-confirm__actions">
        <DialogCancel autoFocus onClick={() => resolveCurrent(false)}>
          {current.cancelLabel ?? t('core.common.cancel')}
        </DialogCancel>
        <DialogClose asChild>
          <Button onClick={() => resolveCurrent(true)} variant={confirmVariant}>
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

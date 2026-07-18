import { type FormEvent, type ReactNode } from 'react';

import { Dialog } from '@/components/headless/Dialog';
import { Button, DialogCancel } from './Button';
import { DialogActions } from './DialogActions';

export function FormDialog({
  busy,
  cancelLabel,
  children,
  className = '',
  description,
  onOpenChange,
  onSubmit,
  open,
  submitLabel,
  title,
}: {
  busy?: boolean;
  cancelLabel: ReactNode;
  children: ReactNode;
  className?: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: () => void | Promise<void>;
  open: boolean;
  submitLabel: ReactNode;
  title: ReactNode;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit();
  };
  return (
    <Dialog description={description} onOpenChange={onOpenChange} open={open} title={title}>
      <form className={`ui-form-dialog${className ? ` ${className}` : ''}`} onSubmit={submit}>
        <div className="ui-form-dialog__body">{children}</div>
        <DialogActions>
          <DialogCancel disabled={busy}>{cancelLabel}</DialogCancel>
          <Button disabled={busy} type="submit" variant="primary">
            {submitLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

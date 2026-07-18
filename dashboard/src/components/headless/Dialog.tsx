import * as DialogPrimitive from '@radix-ui/react-dialog';
import { type ReactElement, type ReactNode } from 'react';

type DialogProps = {
  children: ReactNode;
  description?: string;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
  title: ReactNode;
  trigger?: ReactElement;
};

export function Dialog({ children, description, onOpenChange, open, title, trigger }: DialogProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <DialogPrimitive.Trigger asChild>{trigger}</DialogPrimitive.Trigger> : null}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="headless-dialog__overlay" />
        <DialogPrimitive.Content className="headless-dialog__content">
          <DialogPrimitive.Title className="headless-dialog__title">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="headless-dialog__description">
              {description}
            </DialogPrimitive.Description>
          ) : null}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export const DialogClose = DialogPrimitive.Close;

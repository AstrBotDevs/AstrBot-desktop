import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { DialogClose } from '@/components/headless/Dialog';

export type ButtonVariant = 'danger' | 'primary' | 'secondary' | 'text' | 'warning';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: ReactNode;
  variant?: ButtonVariant;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, className = '', icon, type = 'button', variant = 'secondary', ...props },
  ref,
) {
  return (
    <button
      className={`ui-button ui-button--${variant}${className ? ` ${className}` : ''}`}
      ref={ref}
      type={type}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
});

export function DialogCancel({ children, className, ...props }: Omit<ButtonProps, 'type' | 'variant'>) {
  return (
    <DialogClose asChild>
      <Button className={className} variant="secondary" {...props}>
        {children}
      </Button>
    </DialogClose>
  );
}

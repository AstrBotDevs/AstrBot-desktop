import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes } from 'react';
import { createPortal } from 'react-dom';

export type FloatingActionsProps = HTMLAttributes<HTMLDivElement>;

export function FloatingActions({ children, className = '', ...props }: FloatingActionsProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className={`ui-floating-actions${className ? ` ${className}` : ''}`} {...props}>
      {children}
    </div>,
    document.body,
  );
}

export const FloatingActionButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function FloatingActionButton({ children, className = '', type = 'button', ...props }, ref) {
    return (
      <button className={`ui-floating-action${className ? ` ${className}` : ''}`} ref={ref} type={type} {...props}>
        {children}
      </button>
    );
  },
);

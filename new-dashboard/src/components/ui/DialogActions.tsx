import { type HTMLAttributes, type ReactNode } from 'react';

export function DialogActions({
  children,
  className = '',
  leading,
  ...props
}: HTMLAttributes<HTMLDivElement> & { leading?: ReactNode }) {
  return (
    <div
      className={`dialog-actions ui-dialog-actions${className ? ` ${className}` : ''}`}
      {...props}
    >
      {leading ? <div className="ui-dialog-actions__leading">{leading}</div> : null}
      {children}
    </div>
  );
}

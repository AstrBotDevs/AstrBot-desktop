import { type HTMLAttributes, type ReactNode } from 'react';

export type StatusChipTone = 'danger' | 'info' | 'neutral' | 'success' | 'warning';

export function StatusChip({
  children,
  className = '',
  tone = 'neutral',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { children: ReactNode; tone?: StatusChipTone }) {
  return (
    <span className={`ui-status-chip ui-status-chip--${tone}${className ? ` ${className}` : ''}`} {...props}>
      {children}
    </span>
  );
}

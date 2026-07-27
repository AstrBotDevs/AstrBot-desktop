import { forwardRef, type ButtonHTMLAttributes } from 'react';

import { MdiIcon } from '@/components/icons/MdiIcon';

export type DisclosureButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-expanded' | 'aria-label' | 'children'
> & {
  collapseLabel: string;
  compact?: boolean;
  direction?: 'down' | 'right';
  expanded: boolean;
  expandLabel: string;
  label?: string;
};

export const DisclosureButton = forwardRef<HTMLButtonElement, DisclosureButtonProps>(function DisclosureButton(
  {
    className = '',
    collapseLabel,
    compact = false,
    direction = 'down',
    expanded,
    expandLabel,
    label = '',
    title,
    type = 'button',
    ...props
  },
  ref,
) {
  const actionLabel = expanded ? collapseLabel : expandLabel;
  const accessibleLabel = label ? `${actionLabel}: ${label}` : actionLabel;

  return (
    <button
      aria-expanded={expanded}
      aria-label={accessibleLabel}
      className={`ui-disclosure-button${compact ? ' ui-disclosure-button--compact' : ''}${direction === 'right' ? ' ui-disclosure-button--tree' : ''}${className ? ` ${className}` : ''}`}
      ref={ref}
      title={title ?? accessibleLabel}
      type={type}
      {...props}
    >
      <MdiIcon
        className="ui-disclosure-button__icon"
        name={direction === 'right' ? 'mdi-chevron-right' : 'mdi-chevron-down'}
      />
    </button>
  );
});

import { forwardRef, type ReactNode } from 'react';

import { Button, type ButtonProps } from './Button';

export type IconButtonProps = Omit<ButtonProps, 'aria-label' | 'children' | 'icon'> & {
  icon: ReactNode;
  label: string;
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className = '', icon, label, title = label, ...props },
  ref,
) {
  return (
    <Button
      aria-label={label}
      className={`ui-icon-button${className ? ` ${className}` : ''}`}
      icon={icon}
      ref={ref}
      title={title}
      {...props}
    />
  );
});

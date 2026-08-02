import type { ComponentPropsWithoutRef } from 'react';

export function SelectionCheckbox({ className = '', ...props }: ComponentPropsWithoutRef<'input'>) {
  return <input {...props} className={`ui-selection-checkbox${className ? ` ${className}` : ''}`} type="checkbox" />;
}

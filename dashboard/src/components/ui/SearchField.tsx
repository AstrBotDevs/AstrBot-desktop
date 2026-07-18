import { forwardRef, type InputHTMLAttributes } from 'react';

import { MdiIcon } from '@/components/icons/MdiIcon';
import { IconButton } from './IconButton';

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> & {
  clearLabel?: string;
  label: string;
  onChange: (value: string) => void;
};

export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  { className = '', clearLabel, label, onChange, value, ...props },
  ref,
) {
  const currentValue = String(value ?? '');
  return (
    <label className={`ui-search-field${className ? ` ${className}` : ''}`}>
      <span className="ui-visually-hidden">{label}</span>
      <MdiIcon aria-hidden="true" name="mdi-magnify" />
      <input
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
        ref={ref}
        type="search"
        value={currentValue}
        {...props}
      />
      {currentValue && clearLabel ? (
        <IconButton
          className="ui-search-field__clear"
          icon={<MdiIcon name="mdi-close" />}
          label={clearLabel}
          onClick={() => onChange('')}
          variant="text"
        />
      ) : null}
    </label>
  );
});

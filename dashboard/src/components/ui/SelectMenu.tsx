import { useEffect, useRef, useState } from 'react';

import { MdiIcon } from '@/components/icons/MdiIcon';

export type SelectMenuOption = {
  disabled?: boolean;
  id: string;
  image?: string;
  name: string;
};

export function SelectMenu({
  ariaLabel,
  className = '',
  disabled = false,
  imageForValue,
  onChange,
  options,
  placeholder,
  value,
}: {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  imageForValue?: (value: string) => string | undefined;
  onChange: (value: string) => void;
  options: SelectMenuOption[];
  placeholder: string;
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className={`ui-select-menu${className ? ` ${className}` : ''}`} ref={root}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        className={!selected ? 'is-placeholder' : ''}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selected ? selected.name : placeholder}</span>
        <MdiIcon name={open ? 'mdi-chevron-up' : 'mdi-chevron-down'} />
      </button>
      {open && (
        <div aria-label={ariaLabel} className="ui-select-menu__menu" role="listbox">
          {options.map((option) => {
            const image = option.image || imageForValue?.(option.id);
            return (
              <button
                aria-selected={option.id === value}
                className={option.id === value ? 'is-selected' : ''}
                disabled={option.disabled}
                key={option.id}
                onClick={() => {
                  onChange(option.id);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                {image && <img alt="" src={image} />}
                <span>{option.name}</span>
                {option.id === value && <MdiIcon name="mdi-check" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { createPortal } from 'react-dom';
import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from 'react';

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
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({ visibility: 'hidden' });
  const menu = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.id === value);

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!root.current?.contains(target) && !menu.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return undefined;
    const positionMenu = () => {
      const trigger = root.current?.querySelector(':scope > button');
      if (!(trigger instanceof HTMLElement)) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
      const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
      const gap = 5;
      const margin = 8;
      const width = Math.min(Math.max(rect.width, 96), viewportWidth - margin * 2);
      const left = Math.min(Math.max(rect.left, margin), viewportWidth - width - margin);
      const measuredHeight = menu.current?.scrollHeight || Math.min(options.length * 42 + 10, 360);
      const spaceBelow = viewportHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const openAbove = spaceBelow < Math.min(measuredHeight, 180) && spaceAbove > spaceBelow;
      const availableHeight = Math.max(80, (openAbove ? spaceAbove : spaceBelow) - gap);

      setMenuStyle({
        bottom: openAbove ? viewportHeight - rect.top + gap : undefined,
        left,
        maxHeight: Math.min(360, availableHeight),
        pointerEvents: 'auto',
        top: openAbove ? undefined : rect.bottom + gap,
        visibility: 'visible',
        width,
      });
    };

    positionMenu();
    window.addEventListener('resize', positionMenu);
    document.addEventListener('scroll', positionMenu, true);
    return () => {
      window.removeEventListener('resize', positionMenu);
      document.removeEventListener('scroll', positionMenu, true);
    };
  }, [open, options.length]);

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
        onClick={() => {
          if (!open) setMenuStyle({ visibility: 'hidden' });
          setOpen((current) => !current);
        }}
        type="button"
      >
        <span>{selected ? selected.name : placeholder}</span>
        <MdiIcon name={open ? 'mdi-chevron-up' : 'mdi-chevron-down'} />
      </button>
      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            aria-label={ariaLabel}
            className="ui-select-menu__menu ui-select-menu__menu--portaled"
            ref={menu}
            role="listbox"
            style={menuStyle}
            onPointerDown={(event) => event.stopPropagation()}
          >
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
          </div>,
          document.body,
        )}
    </div>
  );
}

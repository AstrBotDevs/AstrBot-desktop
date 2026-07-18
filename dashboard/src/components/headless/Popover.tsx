import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';

type PopoverProps = {
  children: ReactNode;
  label: string;
  trigger: (props: {
    'aria-expanded': boolean;
    'aria-haspopup': 'dialog';
    onClick: () => void;
    ref: RefObject<HTMLButtonElement | null>;
  }) => ReactNode;
};

export function Popover({ children, label, trigger }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => contentRef.current?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="headless-popover" ref={rootRef}>
      {trigger({
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        onClick: () => setOpen((value) => !value),
        ref: triggerRef,
      })}
      {open && (
        <div
          aria-label={label}
          className="headless-popover__content"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              requestAnimationFrame(() => triggerRef.current?.focus());
            }
          }}
          ref={contentRef}
          role="dialog"
          tabIndex={-1}
        >
          {children}
        </div>
      )}
    </div>
  );
}

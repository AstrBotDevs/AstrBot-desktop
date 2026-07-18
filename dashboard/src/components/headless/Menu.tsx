import {
  createContext,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';

type TriggerProps = {
  'aria-expanded': boolean;
  'aria-haspopup': 'menu';
  onClick: () => void;
  ref: RefObject<HTMLButtonElement | null>;
};

type MenuProps = {
  children: ReactNode;
  className?: string;
  label: string;
  trigger: (props: TriggerProps) => ReactNode;
};

const MenuContext = createContext<{ close: (restoreFocus?: boolean) => void } | null>(null);

function getItems(container: HTMLElement | null) {
  return container ? Array.from(container.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])')) : [];
}

export function getNextMenuItemIndex(key: string, currentIndex: number, itemCount: number) {
  if (itemCount <= 0) return null;
  if (key === 'ArrowDown') return (currentIndex + 1) % itemCount;
  if (key === 'ArrowUp') return (currentIndex - 1 + itemCount) % itemCount;
  if (key === 'Home') return 0;
  if (key === 'End') return itemCount - 1;
  return null;
}

export function Menu({ children, className = '', label, trigger }: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => getItems(contentRef.current)[0]?.focus());
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = getItems(contentRef.current);
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex = getNextMenuItemIndex(event.key, currentIndex, items.length);
    if (event.key === 'Escape') close();
    else if (event.key === 'Tab') close(false);
    if (nextIndex != null && items[nextIndex]) {
      event.preventDefault();
      items[nextIndex].focus();
    }
  };

  return (
    <div className={`headless-menu${className ? ` ${className}` : ''}`} ref={rootRef}>
      {trigger({
        'aria-expanded': open,
        'aria-haspopup': 'menu',
        onClick: () => setOpen((value) => !value),
        ref: triggerRef,
      })}
      {open && (
        <MenuContext.Provider value={{ close }}>
          <div aria-label={label} className="headless-menu__content" onKeyDown={onKeyDown} ref={contentRef} role="menu">
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
}

type MenuItemProps = {
  children: ReactNode;
  disabled?: boolean;
  onSelect?: () => void;
};

export function MenuItem({ children, disabled = false, onSelect }: MenuItemProps) {
  const context = useContext(MenuContext);
  return (
    <button
      className="headless-menu__item"
      disabled={disabled}
      onClick={() => {
        onSelect?.();
        context?.close();
      }}
      role="menuitem"
      tabIndex={-1}
      type="button"
    >
      {children}
    </button>
  );
}

import {
  Children,
  Fragment,
  isValidElement,
  type ChangeEventHandler,
  type OptionHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  useMemo,
  useRef,
} from 'react';

import { SelectMenu, type SelectMenuOption } from './SelectMenu';

type SelectControlProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'> & {
  children: ReactNode;
};

function optionLabel(children: ReactNode) {
  return Children.toArray(children)
    .map((child) => (typeof child === 'string' || typeof child === 'number' ? String(child) : ''))
    .join('');
}

function collectOptions(children: ReactNode, options: SelectMenuOption[] = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Fragment || child.type === 'optgroup') {
      collectOptions((child.props as { children?: ReactNode }).children, options);
      return;
    }
    if (child.type !== 'option') return;
    const props = child.props as OptionHTMLAttributes<HTMLOptionElement>;
    const name = optionLabel(props.children);
    options.push({
      disabled: props.disabled,
      id: String(props.value ?? name),
      name,
    });
  });
  return options;
}

export function SelectControl({
  'aria-label': ariaLabel,
  children,
  className = '',
  defaultValue,
  disabled,
  onChange,
  value,
  ...props
}: SelectControlProps) {
  const nativeRef = useRef<HTMLSelectElement>(null);
  const options = useMemo(() => collectOptions(children), [children]);
  const selectedValue = String(value ?? defaultValue ?? options[0]?.id ?? '');
  const selectedName = options.find((option) => option.id === selectedValue)?.name || '';

  const selectValue = (nextValue: string) => {
    const select = nativeRef.current;
    if (!select) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, nextValue);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  return (
    <>
      <select
        {...props}
        aria-hidden="true"
        className="ui-select-control__native"
        disabled={disabled}
        onChange={onChange as ChangeEventHandler<HTMLSelectElement>}
        ref={nativeRef}
        tabIndex={-1}
        value={value}
        defaultValue={value === undefined ? defaultValue : undefined}
      >
        {children}
      </select>
      <SelectMenu
        ariaLabel={ariaLabel || selectedName || 'Select'}
        className={className}
        disabled={disabled}
        onChange={selectValue}
        options={options}
        placeholder={selectedName || options[0]?.name || ''}
        value={selectedValue}
      />
    </>
  );
}

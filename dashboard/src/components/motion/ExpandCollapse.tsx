import type { ReactNode } from 'react';

type ExpandCollapseProps = {
  children: ReactNode;
  className?: string;
  open: boolean;
};

/** Keeps content mounted so both expansion and collapse can be animated. */
export function ExpandCollapse({ children, className = '', open }: ExpandCollapseProps) {
  return (
    <div
      aria-hidden={!open}
      className={`expand-collapse${className ? ` ${className}` : ''}`}
      data-state={open ? 'open' : 'closed'}
      inert={!open}
    >
      <div className="expand-collapse__inner">{children}</div>
    </div>
  );
}

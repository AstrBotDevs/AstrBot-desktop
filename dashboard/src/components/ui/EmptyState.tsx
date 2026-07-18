import { type HTMLAttributes, type ReactNode } from 'react';

export type EmptyStateProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
  action?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
};

export function EmptyState({ action, className = '', description, icon, title, ...props }: EmptyStateProps) {
  return (
    <div className={`ui-empty-state${className ? ` ${className}` : ''}`} {...props}>
      {icon ? <div className="ui-empty-state__icon">{icon}</div> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {action ? <div className="ui-empty-state__action">{action}</div> : null}
    </div>
  );
}

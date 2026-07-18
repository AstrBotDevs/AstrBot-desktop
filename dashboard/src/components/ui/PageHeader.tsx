import { type HTMLAttributes, type ReactNode } from 'react';

export type PageHeaderProps = Omit<HTMLAttributes<HTMLElement>, 'title'> & {
  actions?: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
};

export function PageHeader({ actions, className = '', description, eyebrow, icon, title, ...props }: PageHeaderProps) {
  return (
    <header className={`ui-page-header${className ? ` ${className}` : ''}`} {...props}>
      <div className="ui-page-header__main">
        {icon ? <div className="ui-page-header__icon">{icon}</div> : null}
        <div className="ui-page-header__copy">
          {eyebrow ? <small>{eyebrow}</small> : null}
          <h1>{title}</h1>
          {description ? <p>{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
    </header>
  );
}

import { type ReactNode } from 'react';

import { MdiIcon } from '@/components/icons/MdiIcon';
import { EmptyState } from './EmptyState';

export function AsyncState({
  children,
  className = '',
  empty,
  error,
  loading,
  loadingLabel,
}: {
  children: ReactNode;
  className?: string;
  empty?: { action?: ReactNode; description?: ReactNode; icon?: ReactNode; title: ReactNode };
  error?: ReactNode;
  loading?: boolean;
  loadingLabel: ReactNode;
}) {
  if (loading) {
    return (
      <div className={`ui-async-state ui-async-state--loading${className ? ` ${className}` : ''}`} role="status">
        <MdiIcon className="mdi-spin" name="mdi-loading" />
        <span>{loadingLabel}</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className={`ui-async-state ui-async-state--error${className ? ` ${className}` : ''}`} role="alert">
        <MdiIcon name="mdi-alert-circle-outline" />
        <span>{error}</span>
      </div>
    );
  }
  if (empty) {
    return (
      <EmptyState
        action={empty.action}
        className={className}
        description={empty.description}
        icon={empty.icon}
        title={empty.title}
      />
    );
  }
  return children;
}

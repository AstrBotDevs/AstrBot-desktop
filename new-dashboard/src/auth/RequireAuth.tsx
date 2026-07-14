import { type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from '@/stores/auth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const hasToken = useAuthStore((state) => state.hasToken);

  if (hasToken) return children;

  const returnUrl = `${location.pathname}${location.search}`;
  return (
    <Navigate
      replace
      state={{ returnUrl }}
      to={`/auth/login?redirect=${encodeURIComponent(returnUrl)}`}
    />
  );
}

import { type ReactNode, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from '@/stores/auth';

export function RequireAuth({ children }: { children: ReactNode }) {
  const location = useLocation();
  const hasToken = useAuthStore((state) => state.hasToken);
  const setReturnUrl = useAuthStore((state) => state.setReturnUrl);
  const returnUrl = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    if (!hasToken) setReturnUrl(returnUrl);
  }, [hasToken, returnUrl, setReturnUrl]);

  if (hasToken) return children;

  return <Navigate replace state={{ returnUrl }} to={`/auth/login?redirect=${encodeURIComponent(returnUrl)}`} />;
}

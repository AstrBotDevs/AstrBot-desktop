import { AUTH_SESSION_EXPIRED_EVENT } from '@/api/http';

type SessionEventTarget = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

export function subscribeToExpiredSession(
  clearSession: () => void,
  target: SessionEventTarget = window,
) {
  const expire = () => clearSession();
  target.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expire);
  return () => target.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expire);
}

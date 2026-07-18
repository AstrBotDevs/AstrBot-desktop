import { describe, expect, it, vi } from 'vitest';

import { AUTH_SESSION_EXPIRED_EVENT } from '@/api/http';
import { subscribeToExpiredSession } from './sessionEvents';

describe('authentication session events', () => {
  it('synchronizes and cleans up expired sessions', () => {
    const target = new EventTarget();
    const clearSession = vi.fn();
    const unsubscribe = subscribeToExpiredSession(clearSession, target);

    target.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    expect(clearSession).toHaveBeenCalledOnce();

    unsubscribe();
    target.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
    expect(clearSession).toHaveBeenCalledOnce();
  });
});

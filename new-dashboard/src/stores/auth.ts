import { create } from 'zustand';

import {
  clearAuthSession,
  persistAuthSession,
  readAuthToken,
  readStoredUsername,
  type AuthSession,
} from '@/auth/storage';
import { resolveAuthenticatedRoute } from '@/auth/sessionFlow';

type Navigate = (to: string, options?: { replace?: boolean }) => void;

type AuthState = {
  completeSession: (
    session: AuthSession,
    navigate: Navigate,
    onboardingCheck?: () => Promise<boolean>,
  ) => Promise<string>;
  clearSession: () => void;
  finishSession: (session: AuthSession) => void;
  hasToken: boolean;
  returnUrl: string | null;
  setReturnUrl: (returnUrl: string | null) => void;
  username: string;
};

export const useAuthStore = create<AuthState>()((set, get) => ({
  hasToken: Boolean(readAuthToken()),
  returnUrl: null,
  username: readStoredUsername(),
  clearSession: () => {
    clearAuthSession();
    set({ hasToken: false, returnUrl: null, username: '' });
  },
  completeSession: async (session, navigate, onboardingCheck) => {
    const returnUrl = get().returnUrl;
    persistAuthSession(session);
    set({ hasToken: true, username: session.username });
    const route = await resolveAuthenticatedRoute(session, onboardingCheck, returnUrl);
    set({ returnUrl: null });
    navigate(route, { replace: true });
    return route;
  },
  finishSession: (session) => {
    persistAuthSession(session);
    set({ hasToken: true, username: session.username });
  },
  setReturnUrl: (returnUrl) => set({ returnUrl }),
}));

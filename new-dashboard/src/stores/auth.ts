import { create } from 'zustand';

import {
  clearAuthSession,
  persistAuthSession,
  readAuthToken,
  readStoredUsername,
  type AuthSession,
} from '@/auth/storage';

type AuthState = {
  clearSession: () => void;
  finishSession: (session: AuthSession) => void;
  hasToken: boolean;
  returnUrl: string | null;
  setReturnUrl: (returnUrl: string | null) => void;
  username: string;
};

export const useAuthStore = create<AuthState>()((set) => ({
  hasToken: Boolean(readAuthToken()),
  returnUrl: null,
  username: readStoredUsername(),
  clearSession: () => {
    clearAuthSession();
    set({ hasToken: false, returnUrl: null, username: '' });
  },
  finishSession: (session) => {
    persistAuthSession(session);
    set({ hasToken: true, username: session.username });
  },
  setReturnUrl: (returnUrl) => set({ returnUrl }),
}));

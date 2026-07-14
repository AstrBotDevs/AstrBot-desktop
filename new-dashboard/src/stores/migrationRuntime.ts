import { create } from 'zustand';

type MigrationRuntimeState = {
  error: string | null;
  legacyRoute: string;
  status: 'idle' | 'loading-legacy' | 'legacy-ready' | 'legacy-error';
  setLegacyError: (error: string) => void;
  setLegacyReady: () => void;
  startLegacyLoad: (route: string) => void;
};

export const useMigrationRuntimeStore = create<MigrationRuntimeState>()((set) => ({
  error: null,
  legacyRoute: '',
  status: 'idle',
  setLegacyError: (error) => set({ error, status: 'legacy-error' }),
  setLegacyReady: () => set({ error: null, status: 'legacy-ready' }),
  startLegacyLoad: (legacyRoute) => set({
    error: null,
    legacyRoute,
    status: 'loading-legacy',
  }),
}));

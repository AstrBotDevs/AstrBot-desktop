import { create } from 'zustand';

export type BackendStatus = 'unknown' | 'ready' | 'starting' | 'restarting' | 'stopped' | 'error';
export type UpdateStatus = 'idle' | 'checking' | 'available' | 'current' | 'installing' | 'error';

type DesktopState = {
  backend?: AstrBotDesktopBackendState;
  backendStatus: BackendStatus;
  error: string | null;
  isDesktop: boolean;
  runtimeChecked: boolean;
  update?: AstrBotDesktopAppUpdateCheckResult;
  updateChannel: string | null;
  updateStatus: UpdateStatus;
  patch: (next: Partial<Omit<DesktopState, 'patch'>>) => void;
};

export const useDesktopStore = create<DesktopState>()((set) => ({
  backendStatus: 'unknown',
  error: null,
  isDesktop: false,
  runtimeChecked: false,
  updateChannel: null,
  updateStatus: 'idle',
  patch: (next) => set(next),
}));

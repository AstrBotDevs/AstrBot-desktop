import { create } from 'zustand';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';
export type ConfirmIntent = 'default' | 'destructive' | 'warning';

export type ToastMessage = {
  closable: boolean;
  id: string;
  message: string;
  timeout: number;
  variant: ToastVariant;
};

export type ConfirmOptions = {
  cancelLabel?: string;
  confirmLabel?: string;
  /** @deprecated Use intent: 'destructive'. */
  danger?: boolean;
  intent?: ConfirmIntent;
  message: string;
  title?: string;
};

type ConfirmRequest = Omit<ConfirmOptions, 'danger' | 'intent'> & {
  id: string;
  intent: ConfirmIntent;
  resolve: (confirmed: boolean) => void;
};

type FeedbackState = {
  confirmQueue: ConfirmRequest[];
  loadingIds: Set<string>;
  loadingProgress: number | null;
  toasts: ToastMessage[];
  addToast: (message: string, options?: Partial<Omit<ToastMessage, 'id' | 'message'>>) => string;
  dismissToast: (id: string) => void;
  finishLoading: (id: string) => void;
  requestConfirmation: (options: ConfirmOptions) => Promise<boolean>;
  resolveConfirmation: (id: string, confirmed: boolean) => void;
  setLoadingProgress: (progress: number | null) => void;
  startLoading: (id?: string) => string;
};

let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

export function normalizeConfirmOptions(options: ConfirmOptions): Omit<ConfirmOptions, 'danger'> & {
  intent: ConfirmIntent;
} {
  const { danger, ...normalized } = options;
  return {
    ...normalized,
    intent: normalized.intent ?? (danger ? 'destructive' : 'default'),
  };
}

export const useFeedbackStore = create<FeedbackState>()((set, get) => ({
  confirmQueue: [],
  loadingIds: new Set(),
  loadingProgress: null,
  toasts: [],
  addToast: (message, options = {}) => {
    const id = nextId('toast');
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          closable: options.closable ?? true,
          id,
          message,
          timeout: options.timeout ?? 3000,
          variant: options.variant ?? 'info',
        },
      ],
    }));
    return id;
  },
  dismissToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
  finishLoading: (id) =>
    set((state) => {
      const loadingIds = new Set(state.loadingIds);
      loadingIds.delete(id);
      return {
        loadingIds,
        loadingProgress: loadingIds.size ? state.loadingProgress : null,
      };
    }),
  requestConfirmation: (options) =>
    new Promise<boolean>((resolve) => {
      set((state) => ({
        confirmQueue: [...state.confirmQueue, { ...normalizeConfirmOptions(options), id: nextId('confirm'), resolve }],
      }));
    }),
  resolveConfirmation: (id, confirmed) => {
    const request = get().confirmQueue.find((item) => item.id === id);
    if (!request) return;
    set((state) => ({
      confirmQueue: state.confirmQueue.filter((item) => item.id !== id),
    }));
    request.resolve(confirmed);
  },
  setLoadingProgress: (progress) =>
    set({
      loadingProgress: progress == null ? null : Math.min(100, Math.max(0, progress)),
    }),
  startLoading: (providedId) => {
    const id = providedId ?? nextId('loading');
    set((state) => ({ loadingIds: new Set(state.loadingIds).add(id) }));
    return id;
  },
}));

export const toast = Object.assign(
  (message: string, options?: Partial<Omit<ToastMessage, 'id' | 'message'>>) =>
    useFeedbackStore.getState().addToast(message, options),
  {
    error: (message: string) => useFeedbackStore.getState().addToast(message, { variant: 'error' }),
    info: (message: string) => useFeedbackStore.getState().addToast(message, { variant: 'info' }),
    success: (message: string) => useFeedbackStore.getState().addToast(message, { variant: 'success' }),
    warning: (message: string) => useFeedbackStore.getState().addToast(message, { variant: 'warning' }),
  },
);

export const confirmAction = (options: ConfirmOptions | string) =>
  useFeedbackStore.getState().requestConfirmation(typeof options === 'string' ? { message: options } : options);

export const loading = {
  finish: (id: string) => useFeedbackStore.getState().finishLoading(id),
  setProgress: (progress: number | null) => useFeedbackStore.getState().setLoadingProgress(progress),
  start: (id?: string) => useFeedbackStore.getState().startLoading(id),
};

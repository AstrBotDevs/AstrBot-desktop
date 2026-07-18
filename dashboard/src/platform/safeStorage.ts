export type SafeStorage = {
  get: (key: string) => string | null;
  remove: (key: string) => void;
  set: (key: string, value: string) => boolean;
};

export function createSafeStorage(storage: Storage | null | undefined): SafeStorage {
  return {
    get(key) {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    remove(key) {
      try {
        storage?.removeItem(key);
      } catch {
        // Storage is optional in SSR, private, and embedded contexts.
      }
    },
    set(key, value) {
      try {
        if (!storage) return false;
        storage.setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function browserStorage(kind: 'local' | 'session' = 'local') {
  if (typeof window === 'undefined') return createSafeStorage(null);
  try {
    return createSafeStorage(kind === 'local' ? window.localStorage : window.sessionStorage);
  } catch {
    return createSafeStorage(null);
  }
}

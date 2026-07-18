type VersionedValue<T> = {
  data: T;
  version: number;
};

export type PersistentValue<T> = {
  key: string;
  read: (storage?: Storage | null) => T;
  remove: (storage?: Storage | null) => void;
  write: (value: T, storage?: Storage | null) => void;
};

type PersistentValueOptions<T> = {
  fallback: T;
  key: string;
  parse: (value: unknown) => T | undefined;
  version?: number;
};

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function definePersistentValue<T>({
  fallback,
  key,
  parse,
  version = 1,
}: PersistentValueOptions<T>): PersistentValue<T> {
  return {
    key,
    read(storage = browserStorage()) {
      if (!storage) return fallback;
      try {
        const raw = storage.getItem(key);
        if (raw == null) return fallback;
        let decoded: unknown = raw;
        try {
          decoded = JSON.parse(raw) as unknown;
        } catch {
          // Legacy string values were stored without JSON encoding.
        }
        const envelope =
          decoded && typeof decoded === 'object' && !Array.isArray(decoded)
            ? (decoded as Partial<VersionedValue<unknown>>)
            : null;
        if (!envelope || envelope.version !== version) {
          const legacy = parse(decoded);
          if (legacy === undefined) {
            storage.removeItem(key);
            return fallback;
          }
          storage.setItem(key, JSON.stringify({ data: legacy, version }));
          return legacy;
        }
        const value = parse(envelope.data);
        if (value !== undefined) return value;
        storage.removeItem(key);
      } catch {
        try {
          storage.removeItem(key);
        } catch {
          // Ignore storage access failures and recover with the fallback.
        }
      }
      return fallback;
    },
    remove(storage = browserStorage()) {
      try {
        storage?.removeItem(key);
      } catch {
        // Storage can be unavailable in private or embedded contexts.
      }
    },
    write(value, storage = browserStorage()) {
      try {
        storage?.setItem(key, JSON.stringify({ data: value, version }));
      } catch {
        // Storage can be unavailable in private or embedded contexts.
      }
    },
  };
}

export const parseBoolean = (value: unknown) =>
  typeof value === 'boolean'
    ? value
    : value === 'true' || value === '1' || value === 1
      ? true
      : value === 'false' || value === '0' || value === 0
        ? false
        : undefined;
export const parseString = (value: unknown) => (typeof value === 'string' ? value : undefined);
export const parseStringArray = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined;

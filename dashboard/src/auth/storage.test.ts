import { describe, expect, it } from 'vitest';

import { AUTH_STORAGE_KEYS, clearAuthSession, persistAuthSession, readAuthToken } from './storage';

function createStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('desktop session storage', () => {
  it('persists the token and username used by API requests', () => {
    const storage = createStorage();
    persistAuthSession(
      {
        token: 'secret',
        username: 'astrbot',
      },
      storage,
    );

    expect(readAuthToken(storage)).toBe('secret');
    expect(storage.getItem('user')).toBe('astrbot');
  });

  it('clears the desktop session keys', () => {
    const storage = createStorage();
    AUTH_STORAGE_KEYS.forEach((key) => storage.setItem(key, 'value'));

    clearAuthSession(storage);

    expect(AUTH_STORAGE_KEYS.every((key) => storage.getItem(key) === null)).toBe(true);
  });
});

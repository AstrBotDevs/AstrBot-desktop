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

describe('auth storage compatibility', () => {
  it('persists the existing dashboard session keys', () => {
    const storage = createStorage();
    persistAuthSession(
      {
        changePwdHint: true,
        passwordUpgradeRequired: true,
        token: 'secret',
        username: 'astrbot',
      },
      storage,
    );

    expect(readAuthToken(storage)).toBe('secret');
    expect(storage.getItem('user')).toBe('astrbot');
    expect(storage.getItem('change_pwd_hint')).toBe('true');
    expect(storage.getItem('md5_pwd_hint')).toBeNull();
    expect(storage.getItem('password_upgrade_required')).toBe('true');
  });

  it('clears every authentication compatibility key', () => {
    const storage = createStorage();
    AUTH_STORAGE_KEYS.forEach((key) => storage.setItem(key, 'value'));

    clearAuthSession(storage);

    expect(AUTH_STORAGE_KEYS.every((key) => storage.getItem(key) === null)).toBe(true);
  });

  it('keeps the legacy MD5 warning precedence', () => {
    const storage = createStorage();
    persistAuthSession(
      {
        md5PwdHint: true,
        passwordUpgradeRequired: true,
        token: 'secret',
        username: 'astrbot',
      },
      storage,
    );

    expect(storage.getItem('change_pwd_hint')).toBeNull();
    expect(storage.getItem('md5_pwd_hint')).toBeNull();
    expect(storage.getItem('password_upgrade_required')).toBe('true');
  });
});

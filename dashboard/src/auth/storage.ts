import { storageKeys } from '@/config/storageKeys';

export const AUTH_STORAGE_KEYS = [storageKeys.auth.username, storageKeys.auth.token] as const;

export type AuthSession = {
  token: string;
  username: string;
};

function browserStorage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

export function readAuthToken(storage = browserStorage()) {
  return storage?.getItem(storageKeys.auth.token) ?? null;
}

export function readStoredUsername(storage = browserStorage()) {
  return storage?.getItem(storageKeys.auth.username) ?? '';
}

export function persistAuthSession(session: AuthSession, storage = browserStorage()) {
  if (!storage) return;

  storage.setItem(storageKeys.auth.username, session.username);
  storage.setItem(storageKeys.auth.token, session.token);
}

export function clearAuthSession(storage = browserStorage()) {
  if (!storage) return;
  AUTH_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
}

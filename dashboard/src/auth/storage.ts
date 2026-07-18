import { storageKeys } from '@/config/storageKeys';

export const AUTH_STORAGE_KEYS = [
  storageKeys.auth.username,
  storageKeys.auth.token,
  storageKeys.auth.changePasswordHint,
  storageKeys.auth.md5PasswordHint,
  storageKeys.auth.passwordUpgradeRequired,
] as const;

export type AuthSession = {
  changePwdHint?: boolean;
  md5PwdHint?: boolean;
  passwordUpgradeRequired?: boolean;
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

  const passwordUpgradeRequired = Boolean(session.passwordUpgradeRequired);
  const md5PwdHint = Boolean(session.md5PwdHint) && !passwordUpgradeRequired;
  const changePwdHint = Boolean(session.changePwdHint) || md5PwdHint;

  storage.setItem(storageKeys.auth.username, session.username);
  storage.setItem(storageKeys.auth.token, session.token);
  setBooleanFlag(storage, storageKeys.auth.changePasswordHint, changePwdHint);
  setBooleanFlag(storage, storageKeys.auth.md5PasswordHint, md5PwdHint);
  setBooleanFlag(storage, storageKeys.auth.passwordUpgradeRequired, passwordUpgradeRequired);
}

export function clearAuthSession(storage = browserStorage()) {
  if (!storage) return;
  AUTH_STORAGE_KEYS.forEach((key) => storage.removeItem(key));
}

function setBooleanFlag(storage: Storage, key: string, enabled?: boolean) {
  if (enabled) {
    storage.setItem(key, 'true');
  } else {
    storage.removeItem(key);
  }
}

export const AUTH_STORAGE_KEYS = [
  'user',
  'token',
  'change_pwd_hint',
  'md5_pwd_hint',
  'password_upgrade_required',
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
  return storage?.getItem('token') ?? null;
}

export function readStoredUsername(storage = browserStorage()) {
  return storage?.getItem('user') ?? '';
}

export function persistAuthSession(session: AuthSession, storage = browserStorage()) {
  if (!storage) return;

  const passwordUpgradeRequired = Boolean(session.passwordUpgradeRequired);
  const md5PwdHint = Boolean(session.md5PwdHint) && !passwordUpgradeRequired;
  const changePwdHint = Boolean(session.changePwdHint) || md5PwdHint;

  storage.setItem('user', session.username);
  storage.setItem('token', session.token);
  setBooleanFlag(storage, 'change_pwd_hint', changePwdHint);
  setBooleanFlag(storage, 'md5_pwd_hint', md5PwdHint);
  setBooleanFlag(storage, 'password_upgrade_required', passwordUpgradeRequired);
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

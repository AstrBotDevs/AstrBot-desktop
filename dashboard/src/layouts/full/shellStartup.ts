export type PasswordSecurityFlags = {
  change_pwd_hint?: boolean;
  md5_pwd_hint?: boolean;
  password_upgrade_required?: boolean;
};

export type PasswordWarning = 'change' | 'md5' | 'upgrade' | null;

export function passwordWarningFromFlags(flags: PasswordSecurityFlags): PasswordWarning {
  if (flags.password_upgrade_required) return 'upgrade';
  if (flags.md5_pwd_hint) return 'md5';
  if (flags.change_pwd_hint) return 'change';
  return null;
}

export function readPasswordWarning(storage: Pick<Storage, 'getItem'>) {
  return passwordWarningFromFlags({
    change_pwd_hint: storage.getItem('change_pwd_hint') === 'true',
    md5_pwd_hint: storage.getItem('md5_pwd_hint') === 'true',
    password_upgrade_required: storage.getItem('password_upgrade_required') === 'true',
  });
}

export function persistPasswordSecurityFlags(
  flags: PasswordSecurityFlags,
  storage: Pick<Storage, 'removeItem' | 'setItem'>,
) {
  setFlag(
    storage,
    'change_pwd_hint',
    Boolean(flags.change_pwd_hint || (flags.md5_pwd_hint && !flags.password_upgrade_required)),
  );
  setFlag(storage, 'md5_pwd_hint', Boolean(flags.md5_pwd_hint && !flags.password_upgrade_required));
  setFlag(storage, 'password_upgrade_required', Boolean(flags.password_upgrade_required));
}

function setFlag(storage: Pick<Storage, 'removeItem' | 'setItem'>, key: string, enabled: boolean) {
  if (enabled) storage.setItem(key, 'true');
  else storage.removeItem(key);
}

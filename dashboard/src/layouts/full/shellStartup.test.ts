import { describe, expect, it } from 'vitest';

import { passwordWarningFromFlags, persistPasswordSecurityFlags, readPasswordWarning } from './shellStartup';

function storage(initial: Record<string, string> = {}) {
  const values = { ...initial };
  return {
    values,
    getItem: (key: string) => values[key] ?? null,
    removeItem: (key: string) => {
      delete values[key];
    },
    setItem: (key: string, value: string) => {
      values[key] = value;
    },
  };
}

describe('full layout startup model', () => {
  it('keeps password upgrade warnings ahead of legacy MD5 warnings', () => {
    expect(passwordWarningFromFlags({ change_pwd_hint: true })).toBe('change');
    expect(passwordWarningFromFlags({ md5_pwd_hint: true })).toBe('md5');
    expect(
      passwordWarningFromFlags({
        md5_pwd_hint: true,
        password_upgrade_required: true,
      }),
    ).toBe('upgrade');
  });

  it('persists and restores the security flags used after refresh', () => {
    const target = storage();
    persistPasswordSecurityFlags({ md5_pwd_hint: true }, target);
    expect(target.values).toEqual({
      change_pwd_hint: 'true',
      md5_pwd_hint: 'true',
    });
    expect(readPasswordWarning(target)).toBe('md5');

    persistPasswordSecurityFlags({}, target);
    expect(target.values).toEqual({});
  });
});

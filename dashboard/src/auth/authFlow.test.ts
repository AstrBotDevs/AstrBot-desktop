import { describe, expect, it } from 'vitest';

import { ApiError } from '@/api/http';
import { authSessionFromResponse, formatRecoveryCode, isRecoveryCodeComplete, requiresTotp } from './authFlow';

describe('authentication page flow', () => {
  it('maps API session flags to legacy localStorage fields', () => {
    expect(
      authSessionFromResponse({
        change_pwd_hint: true,
        token: 'token',
        username: 'astrbot',
      }),
    ).toEqual({
      changePwdHint: true,
      md5PwdHint: undefined,
      passwordUpgradeRequired: undefined,
      token: 'token',
      username: 'astrbot',
    });
  });

  it('recognizes the TOTP challenge response', () => {
    expect(
      requiresTotp(
        new ApiError('TOTP required', 401, {
          data: { totp_required: true },
          status: 'error',
        }),
      ),
    ).toBe(true);
  });

  it('normalizes and validates recovery codes', () => {
    const code = formatRecoveryCode('abcd2345-efgh2673-ijkl2345-mnop2673');
    expect(code).toBe('ABCD2345-EFGH2673-IJKL2345-MNOP2673');
    expect(isRecoveryCodeComplete(code)).toBe(true);
  });
});

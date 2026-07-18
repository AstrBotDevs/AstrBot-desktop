import { ApiError, type ApiEnvelope } from '@/api/http';
import type { AuthSessionResponse, CompatibleApiResponse } from '@/api/auth';
import type { AuthSession } from './storage';

export type LoginStage = 'account' | 'totp' | 'recovery';

export function authSessionFromResponse(data: AuthSessionResponse): AuthSession {
  return {
    changePwdHint: data.change_pwd_hint,
    md5PwdHint: data.md5_pwd_hint,
    passwordUpgradeRequired: data.password_upgrade_required,
    token: data.token,
    username: data.username,
  };
}

export function requireAuthSession(response: CompatibleApiResponse<AuthSessionResponse>) {
  if (response.data.status === 'error') {
    throw new Error(response.data.message || 'Authentication failed.');
  }
  if (!response.data.data?.token) throw new Error('Authentication response did not include a token.');
  return authSessionFromResponse(response.data.data);
}

export function requiresTotp(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  const envelope = error.payload as ApiEnvelope<{ totp_required?: boolean }> | undefined;
  return Boolean(envelope?.data?.totp_required);
}

export function formatRecoveryCode(raw: string) {
  const normalized = raw
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '')
    .slice(0, 32);
  return normalized.match(/.{1,8}/g)?.join('-') ?? '';
}

export function isRecoveryCodeComplete(code: string) {
  return code.replace(/[^A-Z2-7]/gi, '').length === 32;
}

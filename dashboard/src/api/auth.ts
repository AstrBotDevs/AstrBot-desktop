import { compatibleRequest, type CompatibleApiResponse } from '@/api/compat';
import type { TotpSetupRequest, UpdateAccountRequest } from '@/api/openapi';

export type LoginRequest = {
  code?: string;
  password: string;
  trust_device_flag?: boolean;
  username: string;
};

export type SetupRequest = {
  confirm_password: string;
  password: string;
  username: string;
};

export type AuthSessionResponse = {
  change_pwd_hint?: boolean;
  md5_pwd_hint?: boolean;
  password_upgrade_required?: boolean;
  token: string;
  totp_required?: boolean;
  username: string;
};

export type SetupStatus = {
  setup_required?: boolean;
  skip_default_password_auth?: boolean;
};

export const authApi = {
  login: (payload: LoginRequest) =>
    compatibleRequest<AuthSessionResponse>('/api/v1/auth/login', '/api/auth/login', jsonPost(payload)),
  logout: () =>
    compatibleRequest<Record<string, unknown>>('/api/v1/auth/logout', '/api/auth/logout', { method: 'POST' }),
  setup: (payload: SetupRequest) =>
    compatibleRequest<AuthSessionResponse>('/api/v1/auth/setup', '/api/auth/setup', jsonPost(payload)),
  setupStatus: () => compatibleRequest<SetupStatus>('/api/v1/auth/setup-status', '/api/auth/setup-status'),
  setupTotp: (payload?: TotpSetupRequest) =>
    compatibleRequest<Record<string, unknown>>(
      '/api/v1/auth/totp/setup',
      '/api/auth/totp/setup',
      payload ? jsonRequest(payload) : { method: 'POST' },
    ),
  recoverTotp: () =>
    compatibleRequest<Record<string, unknown>>('/api/v1/auth/totp/recovery', '/api/auth/totp/recovery', {
      method: 'POST',
    }),
  updateAccount: (payload: UpdateAccountRequest) =>
    compatibleRequest<Record<string, unknown>>(
      '/api/v1/auth/account',
      '/api/auth/account/edit',
      jsonRequest(payload, 'PATCH'),
      jsonRequest(payload),
    ),
};

export type { CompatibleApiResponse };

function jsonRequest(payload: object, method = 'POST'): RequestInit {
  return { body: JSON.stringify(payload), method };
}

const jsonPost = jsonRequest;

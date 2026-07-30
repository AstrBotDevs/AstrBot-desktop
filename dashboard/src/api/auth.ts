import { compatibleRequest, type CompatibleApiResponse } from '@/api/compat';
import type { TotpSetupRequest } from '@/api/openapi';

export const authApi = {
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
};

export type { CompatibleApiResponse };

function jsonRequest(payload: object, method = 'POST'): RequestInit {
  return { body: JSON.stringify(payload), method };
}

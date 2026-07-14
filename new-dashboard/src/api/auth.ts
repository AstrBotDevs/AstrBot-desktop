import { apiRequest, isLegacyFallbackError, type ApiEnvelope } from '@/api/http';

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

export type CompatibleApiResponse<T> = {
  data: ApiEnvelope<T>;
  legacyFallback: boolean;
};

export const authApi = {
  login: (payload: LoginRequest) => compatibleRequest<AuthSessionResponse>(
    '/api/v1/auth/login',
    '/api/auth/login',
    jsonPost(payload),
  ),
  logout: () => compatibleRequest<Record<string, unknown>>(
    '/api/v1/auth/logout',
    '/api/auth/logout',
    { method: 'POST' },
  ),
  setup: (payload: SetupRequest) => compatibleRequest<AuthSessionResponse>(
    '/api/v1/auth/setup',
    '/api/auth/setup',
    jsonPost(payload),
  ),
  setupStatus: () => compatibleRequest<SetupStatus>(
    '/api/v1/auth/setup-status',
    '/api/auth/setup-status',
  ),
};

export async function compatibleRequest<T>(
  primaryPath: string,
  legacyPath: string,
  init?: RequestInit,
): Promise<CompatibleApiResponse<T>> {
  try {
    const data = await apiRequest<T>(primaryPath, init);
    if (data.status === 'error' && data.message?.toLowerCase().includes('missing api key')) {
      return { data: await apiRequest<T>(legacyPath, init), legacyFallback: true };
    }
    return { data, legacyFallback: false };
  } catch (error) {
    if (!isLegacyFallbackError(error)) throw error;
    return { data: await apiRequest<T>(legacyPath, init), legacyFallback: true };
  }
}

function jsonPost(payload: object): RequestInit {
  return { body: JSON.stringify(payload), method: 'POST' };
}

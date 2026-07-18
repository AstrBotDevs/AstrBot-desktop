import { clearAuthSession, readAuthToken } from '@/auth/storage';
import { localePreference } from '@/config/preferences';

const AUTH_CHALLENGE_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/setup-status',
  '/api/v1/auth/login',
  '/api/v1/auth/setup',
  '/api/v1/auth/setup-status',
]);

export const AUTH_SESSION_EXPIRED_EVENT = 'astrbot:auth-session-expired';

export type ApiEnvelope<T> = {
  data: T;
  message?: string | null;
  status: 'ok' | 'error';
};

export class ApiError extends Error {
  readonly payload: unknown;
  readonly status: number;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = 'ApiError';
    this.payload = payload;
    this.status = status;
  }
}

export type RequestDependencies = {
  fetch?: typeof fetch;
  onUnauthorized?: () => void;
  skipUnauthorizedHandling?: boolean;
  storage?: Storage | null;
};

function requestStorage(dependencies: RequestDependencies) {
  return dependencies.storage === undefined
    ? typeof window === 'undefined'
      ? null
      : window.localStorage
    : dependencies.storage;
}

function authenticatedHeaders(input: RequestInfo | URL, init: RequestInit, storage: Storage | null) {
  const inputHeaders = typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined;
  const headers = new Headers(init.headers ?? inputHeaders);
  const token = readAuthToken(storage);
  const locale = localePreference.read(storage);

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  if (locale && !headers.has('Accept-Language')) {
    headers.set('Accept-Language', locale);
  }
  return headers;
}

function requestPath(input: RequestInfo | URL) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Authenticated raw fetch for streams, blobs, and other responses that must
 * not be parsed as an API envelope.
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {},
  dependencies: RequestDependencies = {},
) {
  const storage = requestStorage(dependencies);
  const fetchImpl = dependencies.fetch ?? fetch;
  const response = await fetchImpl(input, {
    ...init,
    headers: authenticatedHeaders(input, init, storage),
  });
  if (!dependencies.skipUnauthorizedHandling) {
    expireUnauthorizedSession(requestPath(input), response.status, storage, dependencies.onUnauthorized);
  }
  return response;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  dependencies: RequestDependencies = {},
): Promise<ApiEnvelope<T>> {
  const storage = requestStorage(dependencies);
  const fetchImpl = dependencies.fetch ?? fetch;
  const headers = authenticatedHeaders(path, init, storage);
  if (init.body && !headers.has('Content-Type') && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetchImpl(path, { ...init, headers });
  const payload = await readResponsePayload(response);

  if (!response.ok) {
    expireUnauthorizedSession(path, response.status, storage, dependencies.onUnauthorized);
    throw new ApiError(readApiErrorMessage(payload, response.statusText), response.status, payload);
  }

  return payload as ApiEnvelope<T>;
}

export function isLegacyFallbackError(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || error.message.toLowerCase().includes('missing api key'));
}

async function readResponsePayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return text;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function readApiErrorMessage(payload: unknown, fallback: string) {
  if (typeof payload === 'string') return payload;
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string' && message) return message;
  }
  return fallback || 'Request failed';
}

export function shouldExpireSession(path: string) {
  const origin = typeof window === 'undefined' ? 'http://localhost' : window.location.origin;
  const pathname = new URL(path, origin).pathname;
  return pathname.startsWith('/api/') && !AUTH_CHALLENGE_PATHS.has(pathname);
}

export function redirectToLogin() {
  if (typeof window !== 'undefined' && !window.location.hash.startsWith('#/auth/login')) {
    window.location.hash = '/auth/login';
  }
}

export function expireUnauthorizedSession(
  path: string,
  status: number,
  storage: Storage | null,
  onUnauthorized: (() => void) | undefined,
) {
  if (status !== 401 || !shouldExpireSession(path)) return false;
  clearAuthSession(storage);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }
  (onUnauthorized ?? redirectToLogin)();
  return true;
}

import type { GhproxyTestRequest, PipInstallRequest, UpdateRequest } from '@/api/openapi';
import { ApiError, apiRequest, type ApiEnvelope } from './http';

export type CompatibleApiResponse<T> = {
  data: ApiEnvelope<T>;
  legacyFallback: boolean;
};

export type CompatibilityExitItem = {
  id: 'api-endpoint-fallback' | 'legacy-recovery' | 'legacy-storage' | 'response-envelope';
  minimumBackendVersion: string;
  removalCondition: string;
  targetDashboardVersion: string;
};

/**
 * Runtime removal metadata. The complete inventory and verification procedure
 * live in docs/dashboard-compatibility-exit-plan.md.
 */
export const compatibilityExitPlan: readonly CompatibilityExitItem[] = [
  {
    id: 'api-endpoint-fallback',
    minimumBackendVersion: 'AstrBot Core 4.x compatibility baseline',
    removalCondition: 'The supported Core floor exposes every registered v1 endpoint and fallback telemetry is zero.',
    targetDashboardVersion: '2.0.0',
  },
  {
    id: 'legacy-recovery',
    minimumBackendVersion: 'AstrBot Core 4.x compatibility baseline',
    removalCondition: 'Dashboard upgrades cannot leave an older Core process serving unversioned recovery routes.',
    targetDashboardVersion: '2.0.0',
  },
  {
    id: 'legacy-storage',
    minimumBackendVersion: 'Not backend-dependent',
    removalCondition: 'One stable release has migrated uiTheme and the Vue Dashboard rollback window is closed.',
    targetDashboardVersion: '2.0.0',
  },
  {
    id: 'response-envelope',
    minimumBackendVersion: 'OpenAPI v1 response contract',
    removalCondition: 'All enabled endpoints use one generated response shape and no legacy envelope remains.',
    targetDashboardVersion: '2.0.0',
  },
] as const;

export type VersionData = {
  change_pwd_hint?: boolean;
  dashboard_version?: string;
  md5_pwd_hint?: boolean;
  password_upgrade_required?: boolean;
  version?: string;
};

export type PublicVersionData = {
  astrbot_code_version?: string;
  astrbot_version?: string;
  webui_version?: string;
};

export type StartTimeData = {
  start_time?: number | string | null;
};

export const publicApi = {
  versions: () => legacyCompatibleRequest<PublicVersionData>('/api/v1/stats/versions', '/api/stat/versions'),
};

export const statsApi = {
  version: () => legacyCompatibleRequest<VersionData>('/api/v1/stats/version', '/api/stat/version'),
  testGhproxy: (payload: GhproxyTestRequest) =>
    legacyCompatibleRequest<{ latency?: number }>(
      '/api/v1/stats/ghproxy/test',
      '/api/stat/test-ghproxy-connection',
      jsonRequest(payload),
    ),
  startTime: () => legacyCompatibleRequest<StartTimeData>('/api/v1/stats/start-time', '/api/stat/start-time'),
  restart: () =>
    legacyCompatibleRequest<Record<string, unknown>>('/api/v1/system/restart', '/api/stat/restart-core', {
      method: 'POST',
    }),
};

export const updatesApi = {
  check: () => legacyCompatibleRequest<Record<string, unknown>>('/api/v1/updates/check', '/api/update/check'),
  releases: (type?: 'core' | 'dashboard') => {
    const query = type ? `?type=${encodeURIComponent(type)}` : '';
    return legacyCompatibleRequest<unknown[]>(`/api/v1/updates/releases${query}`, `/api/update/releases${query}`);
  },
  core: (payload?: UpdateRequest) =>
    legacyCompatibleRequest<Record<string, unknown>>(
      '/api/v1/updates/core',
      '/api/update/do',
      payload ? jsonRequest(payload) : { method: 'POST' },
    ),
  dashboard: (payload?: UpdateRequest) =>
    legacyCompatibleRequest<Record<string, unknown>>(
      '/api/v1/updates/dashboard',
      '/api/update/dashboard',
      payload ? jsonRequest(payload) : { method: 'POST' },
    ),
  progress: (taskId: string) =>
    legacyCompatibleRequest<Record<string, unknown>>(
      `/api/v1/updates/progress/${encodeURIComponent(taskId)}`,
      `/api/update/progress?id=${encodeURIComponent(taskId)}`,
    ),
  installPip: (payload: PipInstallRequest) =>
    legacyCompatibleRequest<Record<string, unknown>>(
      '/api/v1/pip/install',
      '/api/update/pip-install',
      jsonRequest(payload),
    ),
};

export const recoveryApi = {
  version: (token: string, fetchImpl?: typeof fetch) =>
    legacyRecoveryRequest<VersionData>('/api/stat/version', token, {}, fetchImpl),
  startTime: (token: string, fetchImpl?: typeof fetch) =>
    legacyRecoveryRequest<StartTimeData>('/api/stat/start-time', token, {}, fetchImpl),
  restart: (token: string, fetchImpl?: typeof fetch) =>
    legacyRecoveryRequest<Record<string, unknown>>('/api/stat/restart-core', token, { method: 'POST' }, fetchImpl),
};

function isMissingApiKeyMessage(message: string | null | undefined) {
  return message?.toLowerCase().includes('missing api key') ?? false;
}

export function shouldFallbackToLegacy(error: unknown) {
  return error instanceof ApiError && (error.status === 404 || isMissingApiKeyMessage(error.message));
}

export async function compatibleRequest<T>(
  primaryPath: string,
  legacyPath: string,
  init?: RequestInit,
  legacyInit: RequestInit | undefined = init,
): Promise<CompatibleApiResponse<T>> {
  try {
    const data = await apiRequest<T>(primaryPath, init);
    if (data.status === 'error' && isMissingApiKeyMessage(data.message)) {
      return { data: await apiRequest<T>(legacyPath, legacyInit), legacyFallback: true };
    }
    return { data, legacyFallback: false };
  } catch (error) {
    if (!shouldFallbackToLegacy(error)) throw error;
    return { data: await apiRequest<T>(legacyPath, legacyInit), legacyFallback: true };
  }
}

function jsonRequest(payload: object): RequestInit {
  return { body: JSON.stringify(payload), method: 'POST' };
}

async function legacyCompatibleRequest<T>(
  primaryPath: string,
  legacyPath: string,
  init?: RequestInit,
): Promise<CompatibleApiResponse<T>> {
  const response = await compatibleRequest<T>(primaryPath, legacyPath, init);
  if (response.data.status === 'error') {
    throw new Error(response.data.message || 'Request failed');
  }
  return response;
}

async function legacyRecoveryRequest<T>(path: string, token: string, init: RequestInit, fetchImpl?: typeof fetch) {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await apiRequest<T>(path, { ...init, headers }, fetchImpl ? { fetch: fetchImpl } : {});
  if (response.status === 'error') throw new Error(response.message || 'Legacy recovery request failed.');
  return response.data;
}

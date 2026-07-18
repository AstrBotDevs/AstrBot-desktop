type ExternalServiceEnvironment = {
  VITE_ASTRBOT_ANNOUNCEMENT_CACHE_TTL_MS?: string;
  VITE_ASTRBOT_ANNOUNCEMENT_ENABLED?: string;
  VITE_ASTRBOT_ANNOUNCEMENT_RETRIES?: string;
  VITE_ASTRBOT_ANNOUNCEMENT_TIMEOUT_MS?: string;
  VITE_ASTRBOT_ANNOUNCEMENT_URL?: string;
};

const DEFAULT_ANNOUNCEMENT_URL = 'https://cloud.astrbot.app/api/v1/announcement';

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value == null || !value.trim()) return fallback;
  return !['0', 'false', 'off', 'no'].includes(value.trim().toLowerCase());
}

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function httpUrl(value: string | undefined, fallback: string) {
  const candidate = value?.trim() || fallback;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

export function resolveExternalServices(environment: ExternalServiceEnvironment) {
  return {
    announcement: {
      cacheTtlMs: boundedInteger(
        environment.VITE_ASTRBOT_ANNOUNCEMENT_CACHE_TTL_MS,
        6 * 60 * 60 * 1000,
        60_000,
        7 * 24 * 60 * 60 * 1000,
      ),
      enabled: parseBoolean(environment.VITE_ASTRBOT_ANNOUNCEMENT_ENABLED, true),
      retries: boundedInteger(environment.VITE_ASTRBOT_ANNOUNCEMENT_RETRIES, 1, 0, 2),
      timeoutMs: boundedInteger(environment.VITE_ASTRBOT_ANNOUNCEMENT_TIMEOUT_MS, 3_500, 500, 30_000),
      url: httpUrl(environment.VITE_ASTRBOT_ANNOUNCEMENT_URL, DEFAULT_ANNOUNCEMENT_URL),
    },
  } as const;
}

export const externalServices = resolveExternalServices(import.meta.env);

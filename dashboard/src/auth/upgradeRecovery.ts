import { recoveryApi } from '@/api/compat';
import { sessionStorageKeys, storageKeys } from '@/config/storageKeys';

export const UPGRADE_RECOVERY_TOKEN_KEY = sessionStorageKeys.upgradeRecoveryToken;

export type LegacyVersionData = {
  dashboard_version?: string;
  version?: string;
};

export type UpgradeRecoveryDetail = LegacyVersionData & {
  blocking?: boolean;
};

export type RestartPollDecision = 'continue' | 'reloaded' | 'timeout';

export function normalizeVersion(version?: string | null) {
  return String(version ?? '')
    .trim()
    .replace(/^v/i, '');
}

export function versionsMismatch(core?: string | null, dashboard?: string | null) {
  const normalizedCore = normalizeVersion(core);
  const normalizedDashboard = normalizeVersion(dashboard);
  return Boolean(normalizedCore && normalizedDashboard && normalizedCore !== normalizedDashboard);
}

export function restartPollDecision(
  initialStartTime: number | string | null,
  nextStartTime: number | string | null,
  attempts: number,
  maxAttempts = 90,
): RestartPollDecision {
  if (nextStartTime != null && initialStartTime != null && String(nextStartTime) !== String(initialStartTime))
    return 'reloaded';
  return attempts >= maxAttempts ? 'timeout' : 'continue';
}

export async function getLegacyStartTime(token = recoveryToken(), fetchImpl: typeof fetch = fetch) {
  const data = await recoveryApi.startTime(token, fetchImpl);
  return data.start_time ?? null;
}

export async function restartLegacyCore(token = recoveryToken(), fetchImpl: typeof fetch = fetch) {
  await recoveryApi.restart(token, fetchImpl);
}

export function recoveryToken() {
  return localStorage.getItem(storageKeys.auth.token) || sessionStorage.getItem(UPGRADE_RECOVERY_TOKEN_KEY) || '';
}

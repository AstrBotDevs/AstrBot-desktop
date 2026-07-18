import type { CompatibleApiResponse, AuthSessionResponse } from '@/api/auth';
import { recoveryApi } from '@/api/compat';
import { sessionStorageKeys, storageKeys } from '@/config/storageKeys';

export const UPGRADE_RECOVERY_EVENT = 'astrbot-upgrade-recovery';
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

export async function legacyUpgradeDetail(
  response: CompatibleApiResponse<AuthSessionResponse>,
  fetchImpl: typeof fetch = fetch,
): Promise<UpgradeRecoveryDetail | null> {
  const token = String(response.data.data?.token ?? '');
  if (!response.legacyFallback || !token) return null;
  const version = await recoveryApi.version(token, fetchImpl);
  return versionsMismatch(version.version, version.dashboard_version) ? { ...version, blocking: true } : null;
}

export function dispatchUpgradeRecovery(detail: UpgradeRecoveryDetail, token?: string) {
  if (token) sessionStorage.setItem(UPGRADE_RECOVERY_TOKEN_KEY, token);
  window.dispatchEvent(new CustomEvent<UpgradeRecoveryDetail>(UPGRADE_RECOVERY_EVENT, { detail }));
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

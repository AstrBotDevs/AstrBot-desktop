import { describe, expect, it } from 'vitest';

import type { AuthSessionResponse } from '@/api/auth';
import type { CompatibleApiResponse } from '@/api/compat';
import { legacyUpgradeDetail, normalizeVersion, restartPollDecision, versionsMismatch } from './upgradeRecovery';

function response(legacyFallback: boolean): CompatibleApiResponse<AuthSessionResponse> {
  return {
    data: {
      data: { token: 'temporary-token', username: 'astrbot' },
      status: 'ok',
    },
    legacyFallback,
  };
}

function versionFetch(version: string, dashboardVersion: string) {
  return async () =>
    new Response(
      JSON.stringify({
        data: { dashboard_version: dashboardVersion, version },
        status: 'ok',
      }),
      { headers: { 'content-type': 'application/json' }, status: 200 },
    );
}

describe('upgrade recovery model', () => {
  it('normalizes version prefixes before comparing', () => {
    expect(normalizeVersion(' v4.1.0 ')).toBe('4.1.0');
    expect(versionsMismatch('v4.1.0', '4.1.0')).toBe(false);
    expect(versionsMismatch('4.0.0', '4.1.0')).toBe(true);
  });

  it('only blocks legacy fallback sessions with mismatched versions', async () => {
    await expect(
      legacyUpgradeDetail(response(false), versionFetch('4.0.0', '4.1.0') as typeof fetch),
    ).resolves.toBeNull();
    await expect(
      legacyUpgradeDetail(response(true), versionFetch('4.1.0', 'v4.1.0') as typeof fetch),
    ).resolves.toBeNull();
    await expect(legacyUpgradeDetail(response(true), versionFetch('4.0.0', '4.1.0') as typeof fetch)).resolves.toEqual({
      blocking: true,
      dashboard_version: '4.1.0',
      version: '4.0.0',
    });
  });

  it('detects restart completion and timeout without treating transient failures as success', () => {
    expect(restartPollDecision(100, null, 1)).toBe('continue');
    expect(restartPollDecision(100, 100, 89)).toBe('continue');
    expect(restartPollDecision(100, 101, 2)).toBe('reloaded');
    expect(restartPollDecision(100, 100, 90)).toBe('timeout');
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/http';
import {
  compatibilityExitPlan,
  compatibleRequest,
  publicApi,
  shouldFallbackToLegacy,
  statsApi,
  updatesApi,
} from './compat';
import { ApiError } from './http';

describe('legacy-compatible API groups', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls public version discovery back to the unversioned route', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: { astrbot_version: '4.0.0' }, status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await publicApi.versions();

    expect(response.data.data.astrbot_version).toBe('4.0.0');
    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/v1/stats/versions', '/api/stat/versions']);
  });

  it('preserves the legacy proxy test request body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: { latency: 25 }, status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await statsApi.testGhproxy({ proxy_url: 'https://proxy.example' });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/stats/ghproxy/test',
      '/api/stat/test-ghproxy-connection',
    ]);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"proxy_url":"https://proxy.example"}');
  });

  it('maps core update and progress calls to their legacy routes', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: {}, status: 'ok' }))
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: { progress: 50 }, status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await updatesApi.core({ reboot: true });
    await updatesApi.progress('task/id');

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/updates/core',
      '/api/update/do',
      '/api/v1/updates/progress/task%2Fid',
      '/api/update/progress?id=task%2Fid',
    ]);
  });

  it('only falls back for an unavailable v1 route or the old missing-key response', () => {
    expect(shouldFallbackToLegacy(new ApiError('Not found', 404, null))).toBe(true);
    expect(shouldFallbackToLegacy(new ApiError('Missing API key', 400, null))).toBe(true);
    expect(shouldFallbackToLegacy(new ApiError('Unauthorized', 401, null))).toBe(false);
    expect(shouldFallbackToLegacy(new ApiError('Server failure', 500, null))).toBe(false);
    expect(shouldFallbackToLegacy(new TypeError('Network unavailable'))).toBe(false);
  });

  it('does not hide authorization or server failures with a legacy request', async () => {
    for (const status of [401, 500]) {
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'Request failed' }, status));
      vi.stubGlobal('fetch', fetchMock);

      await expect(compatibleRequest('/api/v1/current', '/api/legacy')).rejects.toMatchObject({ status });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('attaches removal metadata to every runtime compatibility category', () => {
    expect(compatibilityExitPlan.map(({ id }) => id)).toEqual([
      'api-endpoint-fallback',
      'legacy-recovery',
      'legacy-storage',
      'response-envelope',
    ]);
    expect(
      compatibilityExitPlan.every(
        ({ minimumBackendVersion, removalCondition, targetDashboardVersion }) =>
          minimumBackendVersion && removalCondition && targetDashboardVersion,
      ),
    ).toBe(true);
  });
});

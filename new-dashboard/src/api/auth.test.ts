import { afterEach, describe, expect, it, vi } from 'vitest';

import { authApi } from './auth';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('compatible authentication API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the legacy endpoint after a v1 404', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({
        data: { setup_required: false },
        status: 'ok',
      }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await authApi.setupStatus();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/auth/setup-status',
      '/api/auth/setup-status',
    ]);
    expect(response.legacyFallback).toBe(true);
  });

  it('falls back when an older server reports a missing API key', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        data: {},
        message: 'Missing API key',
        status: 'error',
      }))
      .mockResolvedValueOnce(jsonResponse({ data: {}, status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await authApi.logout();

    expect(response.legacyFallback).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

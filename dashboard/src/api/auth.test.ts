import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/http';
import { authApi } from './auth';

describe('compatible authentication API', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('falls back to the legacy endpoint after a v1 404', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(
        jsonResponse({
          data: { setup_required: false },
          status: 'ok',
        }),
      );
    vi.stubGlobal('fetch', fetchMock);

    const response = await authApi.setupStatus();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/v1/auth/setup-status', '/api/auth/setup-status']);
    expect(response.legacyFallback).toBe(true);
  });

  it('falls back when an older server reports a missing API key', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {},
          message: 'Missing API key',
          status: 'error',
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: {}, status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await authApi.logout();

    expect(response.legacyFallback).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('uses the legacy TOTP setup endpoint with the same POST body', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: { secret: 'secret' }, status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await authApi.setupTotp({ code: '123456' });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/v1/auth/totp/setup', '/api/auth/totp/setup']);
    expect(fetchMock.mock.calls.map(([, init]) => [init?.method, init?.body])).toEqual([
      ['POST', '{"code":"123456"}'],
      ['POST', '{"code":"123456"}'],
    ]);
  });

  it('changes the account method from PATCH to POST for the legacy endpoint', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: {}, status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await authApi.updateAccount({ password: 'current', new_username: 'astrbot' });

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual(['/api/v1/auth/account', '/api/auth/account/edit']);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['PATCH', 'POST']);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe('{"password":"current","new_username":"astrbot"}');
  });
});

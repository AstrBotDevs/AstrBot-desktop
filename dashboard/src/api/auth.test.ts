import { afterEach, describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/http';
import { authApi } from './auth';

describe('TOTP account security API', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('uses the legacy TOTP recovery endpoint', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'Not found' }, 404))
      .mockResolvedValueOnce(jsonResponse({ data: {}, status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);

    await authApi.recoverTotp();

    expect(fetchMock.mock.calls.map(([path]) => path)).toEqual([
      '/api/v1/auth/totp/recovery',
      '/api/auth/totp/recovery',
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(['POST', 'POST']);
    expect(fetchMock.mock.calls.map(([, init]) => init?.body)).toEqual([undefined, undefined]);
  });
});

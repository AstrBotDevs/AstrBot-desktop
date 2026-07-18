import { describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/http';
import { memoryStorage } from '@/test/storage';
import { ApiError, apiRequest, fetchWithAuth } from './http';

describe('apiRequest', () => {
  it('preserves token and locale headers used by the legacy dashboard', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: { ready: true },
        status: 'ok',
      }),
    );

    await apiRequest<{ ready: boolean }>(
      '/api/v1/status',
      {},
      {
        fetch: fetchMock,
        storage: memoryStorage({ 'astrbot-locale': 'zh-CN', token: 'secret' }),
      },
    );

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret');
    expect(headers.get('Accept-Language')).toBe('zh-CN');
  });

  it('expires the stored session after a protected API returns 401', async () => {
    const storage = memoryStorage({ token: 'expired', user: 'astrbot' });
    const onUnauthorized = vi.fn();

    await expect(
      apiRequest(
        '/api/v1/config',
        {},
        {
          fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'expired' }, 401)),
          onUnauthorized,
          storage,
        },
      ),
    ).rejects.toEqual(expect.objectContaining({ status: 401 }));

    expect(storage.getItem('token')).toBeNull();
    expect(storage.getItem('user')).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not redirect when login itself returns an authentication challenge', async () => {
    const onUnauthorized = vi.fn();

    await expect(
      apiRequest(
        '/api/v1/auth/login',
        {},
        {
          fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'TOTP required' }, 401)),
          onUnauthorized,
          storage: memoryStorage(),
        },
      ),
    ).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('accepts an empty successful response', async () => {
    await expect(
      apiRequest(
        '/api/v1/auth/logout',
        {},
        {
          fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
          storage: memoryStorage(),
        },
      ),
    ).resolves.toBeNull();
  });
});

describe('fetchWithAuth', () => {
  it('preserves raw responses while attaching auth and locale headers', async () => {
    const response = new Response('stream', {
      headers: { 'content-type': 'text/event-stream' },
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);

    await expect(
      fetchWithAuth(
        '/api/v1/chat',
        {
          headers: { 'X-Request-ID': 'request-one' },
        },
        {
          fetch: fetchMock,
          storage: memoryStorage({ 'astrbot-locale': 'en-US', token: 'secret' }),
        },
      ),
    ).resolves.toBe(response);

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret');
    expect(headers.get('Accept-Language')).toBe('en-US');
    expect(headers.get('X-Request-ID')).toBe('request-one');
  });

  it('expires the session for unauthorized raw API responses', async () => {
    const storage = memoryStorage({ token: 'expired', user: 'astrbot' });
    const onUnauthorized = vi.fn();

    await fetchWithAuth(
      '/api/v1/logs/live',
      {},
      {
        fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
        onUnauthorized,
        storage,
      },
    );

    expect(storage.getItem('token')).toBeNull();
    expect(storage.getItem('user')).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });
});

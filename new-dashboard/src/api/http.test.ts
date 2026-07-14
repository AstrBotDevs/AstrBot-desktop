import { describe, expect, it, vi } from 'vitest';

import { ApiError, apiRequest } from './http';

function createStorage(entries: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(entries));
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, value); },
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

describe('apiRequest', () => {
  it('preserves token and locale headers used by the legacy dashboard', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({
      data: { ready: true },
      status: 'ok',
    }));

    await apiRequest<{ ready: boolean }>('/api/v1/status', {}, {
      fetch: fetchMock,
      storage: createStorage({ 'astrbot-locale': 'zh-CN', token: 'secret' }),
    });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get('Authorization')).toBe('Bearer secret');
    expect(headers.get('Accept-Language')).toBe('zh-CN');
  });

  it('expires the stored session after a protected API returns 401', async () => {
    const storage = createStorage({ token: 'expired', user: 'astrbot' });
    const onUnauthorized = vi.fn();

    await expect(apiRequest('/api/v1/config', {}, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'expired' }, 401)),
      onUnauthorized,
      storage,
    })).rejects.toEqual(expect.objectContaining({ status: 401 }));

    expect(storage.getItem('token')).toBeNull();
    expect(storage.getItem('user')).toBeNull();
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('does not redirect when login itself returns an authentication challenge', async () => {
    const onUnauthorized = vi.fn();

    await expect(apiRequest('/api/v1/auth/login', {}, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'TOTP required' }, 401)),
      onUnauthorized,
      storage: createStorage(),
    })).rejects.toBeInstanceOf(ApiError);

    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('accepts an empty successful response', async () => {
    await expect(apiRequest('/api/v1/auth/logout', {}, {
      fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 })),
      storage: createStorage(),
    })).resolves.toBeNull();
  });
});

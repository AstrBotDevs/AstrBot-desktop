import { describe, expect, it, vi } from 'vitest';

import { sessionStorageKeys } from '@/config/storageKeys';
import { createSafeStorage } from '@/platform/safeStorage';
import { memoryStorage } from '@/test/storage';
import { loadWelcomeAnnouncement } from './announcementService';

const service = {
  cacheTtlMs: 60_000,
  enabled: true,
  retries: 1,
  timeoutMs: 1_000,
  url: 'https://notice.example.test/v1',
} as const;

describe('announcement service', () => {
  it('omits credentials and referrer, then reuses the session cache', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: { notice: { welcome_page: { 'zh-CN': '欢迎' } } } }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    const storage = createSafeStorage(memoryStorage());

    await expect(loadWelcomeAnnouncement({ fetch: fetchMock, now: () => 1_000, service, storage })).resolves.toEqual({
      'zh-CN': '欢迎',
    });
    await expect(loadWelcomeAnnouncement({ fetch: fetchMock, now: () => 2_000, service, storage })).resolves.toEqual({
      'zh-CN': '欢迎',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  });

  it('retries within budget and falls back to stale cache without rejecting', async () => {
    const rawStorage = memoryStorage();
    rawStorage.setItem(
      sessionStorageKeys.announcementCache,
      JSON.stringify({ expiresAt: 1, value: { 'en-US': 'cached' } }),
    );
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));

    await expect(
      loadWelcomeAnnouncement({
        fetch: fetchMock,
        now: () => 2,
        service,
        storage: createSafeStorage(rawStorage),
      }),
    ).resolves.toEqual({ 'en-US': 'cached' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not access the network when disabled', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    await expect(
      loadWelcomeAnnouncement({ fetch: fetchMock, service: { ...service, enabled: false } }),
    ).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts a slow request at the configured timeout', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn<typeof fetch>((_input, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    });
    const pending = loadWelcomeAnnouncement({
      fetch: fetchMock,
      service: { ...service, retries: 0, timeoutMs: 10 },
      storage: createSafeStorage(memoryStorage()),
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });
});

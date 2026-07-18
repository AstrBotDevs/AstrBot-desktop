import { describe, expect, it, vi } from 'vitest';

import { jsonResponse } from '@/test/http';
import { memoryStorage } from '@/test/storage';
import {
  backupFilesApi,
  conversationFilesApi,
  pluginExtensionApi,
  SystemConfigTwoFactorRequired,
  systemConfigApi,
} from './services';

describe('page-facing API services', () => {
  it('exports conversations and downloads encoded backup filenames as blobs', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('jsonl archive'))
      .mockResolvedValueOnce(new Response('zip archive'));
    const dependencies = { fetch: fetchMock, storage: null };

    await expect(conversationFilesApi.export([{ cid: 'c1', user_id: 'u1' }], dependencies)).resolves.toBeInstanceOf(
      Blob,
    );
    await expect(backupFilesApi.download('backup name.zip', dependencies)).resolves.toBeInstanceOf(Blob);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/v1/conversations/export');
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: '{"conversations":[{"cid":"c1","user_id":"u1"}]}',
      method: 'POST',
    });
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/v1/backups/backup%20name.zip');
  });

  it('maps system-config 2FA challenges without expiring the session', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          data: { totp_required: true },
          status: 'error',
        },
        401,
      ),
    );
    const storage = memoryStorage({ token: 'session-token' });
    const onUnauthorized = vi.fn();

    await expect(
      systemConfigApi.update({ timezone: 'UTC' }, undefined, {
        fetch: fetchMock,
        onUnauthorized,
        storage,
      }),
    ).rejects.toBeInstanceOf(SystemConfigTwoFactorRequired);
    expect(storage.getItem('token')).toBe('session-token');
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('surfaces non-2FA HTTP failures as API errors', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ message: 'denied' }, 403));
    await expect(systemConfigApi.update({}, undefined, { fetch: fetchMock, storage: null })).rejects.toMatchObject({
      message: 'denied',
      status: 403,
    });
  });

  it('keeps plugin bridge requests inside their encoded namespace', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        data: { saved: true },
        status: 'ok',
      }),
    );

    await expect(
      pluginExtensionApi.request(
        'plugin/name',
        'api:post',
        '/records/中文',
        { page: 2 },
        { title: 'test' },
        { fetch: fetchMock, storage: null },
      ),
    ).resolves.toEqual({ saved: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      '/api/v1/plugins/extensions/plugin%2Fname/records/%E4%B8%AD%E6%96%87?page=2',
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: '{"title":"test"}',
      method: 'POST',
    });
  });
});

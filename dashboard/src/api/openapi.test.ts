import type { AxiosAdapter, AxiosResponse } from 'axios';
import { describe, expect, it } from 'vitest';

import { getVersion, listProviders } from '@/api/generated/openapi-v1';
import { createOpenApiAxiosClient } from './openapi';

function createStorage(values: Record<string, string>): Storage {
  return {
    get length() {
      return Object.keys(values).length;
    },
    clear: () => Object.keys(values).forEach((key) => delete values[key]),
    getItem: (key) => values[key] ?? null,
    key: (index) => Object.keys(values)[index] ?? null,
    removeItem: (key) => {
      delete values[key];
    },
    setItem: (key, value) => {
      values[key] = value;
    },
  };
}

describe('generated OpenAPI client', () => {
  it('exports generated endpoint functions', () => {
    expect(getVersion).toBeTypeOf('function');
    expect(listProviders).toBeTypeOf('function');
  });

  it('attaches existing authentication and locale headers', async () => {
    const storage = createStorage({ token: 'secret', 'astrbot-locale': 'en-US' });
    const client = createOpenApiAxiosClient({ storage });
    let headers: Record<string, unknown> = {};
    const adapter: AxiosAdapter = async (config) => {
      headers = config.headers?.toJSON() ?? {};
      return { config, data: {}, headers: {}, status: 200, statusText: 'OK' };
    };

    await client.get('/api/v1/stat/version', { adapter });

    expect(headers.Authorization).toBe('Bearer secret');
    expect(headers['Accept-Language']).toBe('en-US');
  });

  it('rejects a successful HTTP response with an error business envelope', async () => {
    const client = createOpenApiAxiosClient({ storage: createStorage({}) });
    const adapter = responseAdapter({
      data: { data: null, message: 'Configuration rejected.', status: 'error' },
      status: 200,
      statusText: 'OK',
    });

    await expect(client.get('/api/v1/system-config', { adapter })).rejects.toMatchObject({
      message: 'Configuration rejected.',
      payload: { data: null, message: 'Configuration rejected.', status: 'error' },
      status: 200,
    });
  });

  it('keeps success envelopes, blobs, and empty responses unchanged', async () => {
    const client = createOpenApiAxiosClient({ storage: createStorage({}) });
    const success = { data: { id: 'one' }, status: 'ok' };
    const blob = new Blob(['content'], { type: 'text/plain' });

    await expect(client.get('/success', { adapter: responseAdapter({ data: success }) })).resolves.toMatchObject({
      data: success,
    });
    await expect(client.get('/blob', { adapter: responseAdapter({ data: blob }) })).resolves.toMatchObject({
      data: blob,
    });
    await expect(
      client.get('/empty', {
        adapter: responseAdapter({ data: undefined, status: 204, statusText: 'No Content' }),
      }),
    ).resolves.toMatchObject({ data: undefined, status: 204 });
  });

  it('leaves explicitly accepted authentication challenges to the caller', async () => {
    const client = createOpenApiAxiosClient({ storage: createStorage({}) });
    const challenge = {
      data: { totp_required: true },
      message: 'Two-factor authentication required.',
      status: 'error',
    };

    await expect(
      client.put(
        '/api/v1/system-config',
        {},
        {
          adapter: responseAdapter({ data: challenge, status: 401, statusText: 'Unauthorized' }),
          validateStatus: () => true,
        },
      ),
    ).resolves.toMatchObject({ data: challenge, status: 401 });
  });
});

function responseAdapter(
  response: Partial<Pick<AxiosResponse, 'data' | 'headers' | 'status' | 'statusText'>>,
): AxiosAdapter {
  return async (config) => ({
    config,
    data: response.data,
    headers: response.headers ?? {},
    status: response.status ?? 200,
    statusText: response.statusText ?? 'OK',
  });
}

import { describe, expect, it } from 'vitest';

import { resolveExternalServices } from './externalServices';

describe('external service deployment config', () => {
  it('can disable and replace the announcement service', () => {
    const config = resolveExternalServices({
      VITE_ASTRBOT_ANNOUNCEMENT_ENABLED: 'false',
      VITE_ASTRBOT_ANNOUNCEMENT_URL: 'https://notice.example.test/v1',
    });
    expect(config.announcement.enabled).toBe(false);
    expect(config.announcement.url).toBe('https://notice.example.test/v1');
  });

  it('bounds retry, timeout and cache values', () => {
    const config = resolveExternalServices({
      VITE_ASTRBOT_ANNOUNCEMENT_CACHE_TTL_MS: '1',
      VITE_ASTRBOT_ANNOUNCEMENT_RETRIES: '99',
      VITE_ASTRBOT_ANNOUNCEMENT_TIMEOUT_MS: '50',
    });
    expect(config.announcement).toMatchObject({ cacheTtlMs: 60_000, retries: 2, timeoutMs: 500 });
  });
});

import { describe, expect, it } from 'vitest';

import {
  hasChatProvider,
  isComputerAccessRuntimeConfigured,
  normalizeComputerAccessRuntime,
  pickDefaultProviderId,
  resolveWelcomeAnnouncement,
} from './welcomeModel';

describe('welcome page model', () => {
  it('recognizes direct and source-backed chat providers', () => {
    expect(hasChatProvider({ providers: [{ provider_type: 'chat_completion' }] })).toBe(true);
    expect(
      hasChatProvider({
        provider_sources: [{ id: 'source', provider_type: 'chat_completion' }],
        providers: [{ provider_source_id: 'source' }],
      }),
    ).toBe(true);
  });

  it('selects the first enabled chat provider for the default config', () => {
    expect(
      pickDefaultProviderId({
        providers: [
          { id: 'disabled', provider_type: 'chat_completion', enable: false },
          { id: 'enabled', provider_type: 'chat_completion', enable: true },
        ],
      }),
    ).toBe('enabled');
    expect(pickDefaultProviderId({ providers: [{ id: 'embedding', provider_type: 'embedding' }] })).toBe('');
  });

  it('keeps the legacy sandbox-to-local compatibility mapping', () => {
    expect(normalizeComputerAccessRuntime('sandbox')).toBe('local');
    expect(normalizeComputerAccessRuntime('other')).toBe('none');
  });

  it('matches the original dashboard computer access completion rule', () => {
    expect(isComputerAccessRuntimeConfigured('local')).toBe(true);
    expect(isComputerAccessRuntimeConfigured('none')).toBe(true);
    expect(isComputerAccessRuntimeConfigured('sandbox')).toBe(true);
    expect(isComputerAccessRuntimeConfigured(undefined)).toBe(false);
    expect(isComputerAccessRuntimeConfigured('other')).toBe(false);
  });

  it('falls back between announcement locales', () => {
    expect(resolveWelcomeAnnouncement({ 'en-US': 'Hello', 'zh-CN': '你好' }, 'ru-RU')).toBe('Hello');
  });
});

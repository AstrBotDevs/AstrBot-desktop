import { describe, expect, it } from 'vitest';

import {
  hasChatProvider,
  isComputerAccessRuntimeConfigured,
  normalizeComputerAccessRuntime,
  resolveWelcomeAnnouncement,
} from './welcomeModel';

describe('welcome page model', () => {
  it('recognizes direct and source-backed chat providers', () => {
    expect(hasChatProvider({ providers: [{ provider_type: 'chat_completion' }] })).toBe(true);
    expect(hasChatProvider({
      provider_sources: [{ id: 'source', provider_type: 'chat_completion' }],
      providers: [{ provider_source_id: 'source' }],
    })).toBe(true);
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

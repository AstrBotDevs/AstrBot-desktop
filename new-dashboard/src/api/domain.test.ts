import { describe, expect, it } from 'vitest';

import {
  parseChatSessions,
  parseConfigProfiles,
  parseKnowledgeBasePage,
  parseProviderSchema,
  parseProviders,
} from './domain';

describe('API domain parsers', () => {
  it('parses provider schema and provider lists with required identifiers', () => {
    expect(parseProviderSchema({
      config_schema: { provider: { config_template: { openai: {} } } },
      model_metadata: { gpt: {} },
      provider_sources: [{ id: 'source-1' }],
      providers: [{ id: 'provider-1', model: 'gpt' }],
    })).toMatchObject({
      providerSources: [{ id: 'source-1' }],
      providers: [{ id: 'provider-1', model: 'gpt' }],
    });
    expect(() => parseProviders({ providers: [{ model: 'missing-id' }] })).toThrow('providers[0].id');
  });

  it('normalizes typed pages and rejects malformed list members', () => {
    expect(parseKnowledgeBasePage({
      items: [{ kb_id: 'kb-1', kb_name: 'Docs' }],
      total: 10,
    })).toMatchObject({
      items: [{ kb_id: 'kb-1', kb_name: 'Docs' }],
      total: 10,
    });
    expect(() => parseChatSessions({ sessions: [{ session_id: '' }] })).toThrow('sessions[0].session_id');
    expect(() => parseConfigProfiles({ profiles: ['invalid'] })).toThrow('config_profiles[0]');
  });
});

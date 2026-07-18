import { describe, expect, it } from 'vitest';
import {
  buildModelProvider,
  formatContextLimit,
  mergeProviderSourceSection,
  mergeProviderWithTemplate,
  providerFromTemplate,
  providerSchemaData,
  providerSourceSections,
  providerTestAction,
  providerTestResult,
  providerTypeOf,
  recordsForType,
  sourceFromTemplate,
} from './providerPageModel';

describe('provider page model', () => {
  it('normalizes current capability and legacy provider types', () => {
    expect(providerTypeOf({ capability: 'chat' })).toBe('chat_completion');
    expect(providerTypeOf({ type: 'openai_tts_api' })).toBe('text_to_speech');
    expect(recordsForType([{ provider_type: 'embedding' }, { capability: 'chat' }], 'embedding')).toHaveLength(1);
  });

  it('extracts provider workbench data from the schema response', () => {
    expect(
      providerSchemaData({
        config_schema: { provider: { config_template: { OpenAI: { provider: 'openai' } } } },
        provider_sources: [{ id: 'openai' }],
        providers: [{ id: 'openai/gpt-4.1' }],
        model_metadata: { 'gpt-4.1': { limit: { context: 1000 } } },
      }),
    ).toMatchObject({
      providerSources: [{ id: 'openai' }],
      providers: [{ id: 'openai/gpt-4.1' }],
      sourceSchema: { config_template: { OpenAI: { provider: 'openai' } } },
      templates: { OpenAI: { provider: 'openai' } },
    });
  });

  it('splits and updates provider-specific source configuration fields', () => {
    const source = {
      id: 'gemini',
      key: 'secret',
      api_base: 'https://example.com',
      provider: 'google',
      provider_type: 'chat_completion',
      timeout: 120,
      safety_settings: [{ category: 'test' }],
    };
    expect(providerSourceSections(source)).toEqual({
      basic: { id: 'gemini', key: 'secret', api_base: 'https://example.com' },
      advanced: { timeout: 120, safety_settings: [{ category: 'test' }] },
    });
    expect(mergeProviderSourceSection(source, { timeout: 30 })).toMatchObject({
      provider: 'google',
      timeout: 30,
      safety_settings: [{ category: 'test' }],
    });
  });

  it('creates a unique source without leaking model-only template fields', () => {
    expect(
      sourceFromTemplate(
        {
          id: 'openai',
          provider: 'openai',
          provider_type: 'chat_completion',
          model: 'gpt-4.1',
          key: '',
        },
        [{ id: 'openai' }],
      ),
    ).toEqual({
      id: 'openai_1',
      provider: 'openai',
      provider_type: 'chat_completion',
      key: '',
      type: undefined,
      enable: true,
    });
    expect(sourceFromTemplate({ id: 'ollama', provider: 'ollama' }, [])).toMatchObject({
      id: 'ollama',
      ollama_disable_thinking: false,
    });
  });

  it('builds model capabilities and compact context metadata', () => {
    const provider = buildModelProvider('openai', 'gpt-4.1', {
      modalities: { input: ['image'] },
      tool_call: true,
      limit: { context: 128000 },
    });
    expect(provider.modalities).toEqual(['text', 'image', 'tool_use']);
    expect(formatContextLimit(provider)).toBe('128K');
  });

  it('keeps every manually configurable capability for a custom model', () => {
    expect(buildModelProvider('openai', 'custom-model')).toMatchObject({
      id: 'openai/custom-model',
      model: 'custom-model',
      modalities: ['text', 'image', 'audio', 'tool_use'],
      provider_source_id: 'openai',
    });
  });

  it('creates typed providers from templates and restores missing fields while editing', () => {
    const template = {
      id: 'dify',
      type: 'dify',
      provider_type: 'agent_runner',
      enable: true,
      nested: { timeout: 30, options: { stream: true } },
    };
    expect(providerFromTemplate(template)).toEqual(template);
    expect(mergeProviderWithTemplate({ id: 'custom', type: 'dify', nested: { timeout: 60 } }, template)).toEqual({
      id: 'custom',
      type: 'dify',
      provider_type: 'agent_runner',
      enable: true,
      nested: { timeout: 60, options: { stream: true } },
    });
  });

  it('accepts only an available provider result without an error', () => {
    expect(providerTestResult({ status: 'available', error: null })).toEqual({
      status: 'available',
      error: null,
    });
    expect(providerTestResult({ status: 'available', error: 'unauthorized' })).toEqual({
      status: 'unavailable',
      error: 'unauthorized',
    });
    expect(providerTestResult({ status: 'unavailable', error: null })).toEqual({
      status: 'unavailable',
      error: null,
    });
    expect(providerTestResult(undefined)).toEqual({
      status: 'unavailable',
      error: null,
    });
  });

  it('does not request tests for disabled providers or agent runners', () => {
    expect(providerTestAction({ enable: false })).toBe('disabled');
    expect(providerTestAction({ enable: false, provider_type: 'agent_runner' })).toBe('disabled');
    expect(providerTestAction({ enable: true, provider_type: 'agent_runner' })).toBe('agent_runner');
    expect(providerTestAction({ enable: true, provider_type: 'embedding' })).toBe('request');
  });
});

import { describe, expect, it } from 'vitest';

import { getProviderIcon, PROVIDER_ICON_URLS } from './providerIcons';

describe('provider icons', () => {
  it('ports every provider icon mapping from the legacy dashboard', () => {
    expect(Object.keys(PROVIDER_ICON_URLS)).toEqual([
      'openai',
      'azure',
      'xai',
      'anthropic',
      'ollama',
      'google',
      'deepseek',
      'modelscope',
      'zhipu',
      'nvidia',
      'siliconflow',
      'moonshot',
      'kimi',
      'kimi-code',
      'longcat',
      'ppio',
      'dify',
      'coze',
      'dashscope',
      'deerflow',
      'fastgpt',
      'lm_studio',
      'fishaudio',
      'minimax',
      'minimax-token-plan',
      'mimo',
      'xiaomi',
      'xiaomi-token-plan',
      '302ai',
      'microsoft',
      'vllm',
      'groq',
      'aihubmix',
      'openrouter',
      'tokenpony',
      'compshare',
      'xinference',
      'bailian',
      'volcengine',
    ]);
  });

  it('normalizes provider names and falls back for unknown providers', () => {
    expect(getProviderIcon(' Google ')).toContain('gemini-color.svg');
    expect(getProviderIcon('unknown')).toBe('');
  });
});

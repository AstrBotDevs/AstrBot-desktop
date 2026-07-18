import { describe, expect, it } from 'vitest';
import { validPluginEndpoint } from '@/api/services';
import { isTrustedPluginMessageOrigin, pluginMessageTargetOrigin } from './pluginBridge';

describe('plugin page bridge endpoint validation', () => {
  it('normalizes a relative plugin endpoint', () => {
    expect(validPluginEndpoint('/records/中文')).toBe('records/%E4%B8%AD%E6%96%87');
  });

  it.each(['../admin', 'records?all=true', 'https://example.com/api', 'records\\secret', ''])(
    'rejects an endpoint outside the plugin namespace: %s',
    (endpoint) => {
      expect(() => validPluginEndpoint(endpoint)).toThrow();
    },
  );
});

describe('plugin page bridge origin validation', () => {
  it('accepts the dashboard origin and sandboxed opaque origin', () => {
    expect(isTrustedPluginMessageOrigin('https://dashboard.example', 'https://dashboard.example')).toBe(true);
    expect(isTrustedPluginMessageOrigin('null', 'https://dashboard.example')).toBe(true);
  });

  it('rejects foreign origins and origin changes after locking', () => {
    expect(isTrustedPluginMessageOrigin('https://evil.example', 'https://dashboard.example')).toBe(false);
    expect(isTrustedPluginMessageOrigin('null', 'https://dashboard.example', 'https://dashboard.example')).toBe(false);
  });

  it('targets a locked non-opaque origin only', () => {
    expect(pluginMessageTargetOrigin('https://dashboard.example')).toBe('https://dashboard.example');
    expect(pluginMessageTargetOrigin('null')).toBe('*');
    expect(pluginMessageTargetOrigin()).toBe('*');
  });
});

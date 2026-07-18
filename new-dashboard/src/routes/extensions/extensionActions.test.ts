import { describe, expect, it } from 'vitest';
import {
  annotatePluginUpdates,
  getSelectedGitHubProxy,
  pluginBatchUpdateFailures,
  pluginUpdateTargets,
} from './extensionActions';

describe('extension actions', () => {
  it('updates only plugins that report an available update', () => {
    expect(
      pluginUpdateTargets([
        { name: 'alpha', has_update: true },
        { name: 'beta', has_update: false },
        { name: 'gamma', has_update: true },
      ]),
    ).toEqual(['alpha', 'gamma']);
  });

  it('uses the selected GitHub proxy only when proxy mode is enabled', () => {
    const values = new Map([
      ['githubProxyRadioValue', '1'],
      ['selectedGitHubProxy', 'https://proxy.example'],
    ]);
    const storage = {
      get length() {
        return values.size;
      },
      clear: () => values.clear(),
      getItem: (key: string) => values.get(key) ?? null,
      key: (index: number) => [...values.keys()][index] ?? null,
      removeItem: (key: string) => {
        values.delete(key);
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    expect(getSelectedGitHubProxy(storage)).toBe('https://proxy.example');
    values.set('githubProxyRadioValue', '{"data":false,"version":1}');
    expect(getSelectedGitHubProxy(storage)).toBe('');
  });

  it('collects failed batch update results from the API envelope', () => {
    const result = pluginBatchUpdateFailures({
      data: {
        status: 'ok',
        data: {
          results: [
            { name: 'alpha', status: 'ok' },
            { name: 'beta', status: 'error', message: 'network error' },
          ],
        },
      },
    });
    expect(result.envelope.status).toBe('ok');
    expect(result.failures).toEqual([{ name: 'beta', status: 'error', message: 'network error' }]);
  });

  it('detects updates from the plugin market bound to each installed plugin', () => {
    const [plugin] = annotatePluginUpdates(
      [
        {
          install_source: { install_method: 'market', market_plugin_id: 'market-alpha', registry_url: '' },
          name: 'alpha',
          updates_enabled: true,
          version: '1.2.0-beta',
        },
      ],
      new Map([['', [{ market_plugin_id: 'market-alpha', version: '1.2.0' }]]]),
    );
    expect(plugin.has_update).toBe(true);
    expect(plugin.online_version).toBe('1.2.0');
  });
});

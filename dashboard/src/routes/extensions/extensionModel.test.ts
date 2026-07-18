import { describe, expect, it } from 'vitest';
import {
  addPluginPinyinSearchIndex,
  filterPlugins,
  localizedPluginConfigText,
  localizedPluginDescription,
  localizedPluginTitle,
  markdownContent,
  markInstalledMarketPlugins,
  marketCategoryCounts,
  marketPluginDisplayName,
  marketPluginList,
  marketPluginTotal,
  normalizePluginUrl,
  pluginAuthor,
  pluginId,
  pluginInstallUrl,
  pluginPages,
  sortMarketPlugins,
} from './extensionModel';

describe('extension model helpers', () => {
  it('normalizes plugin identity and repository URLs', () => {
    expect(pluginId({ module_name: 'astrbot_plugin_demo' })).toBe('astrbot_plugin_demo');
    expect(normalizePluginUrl('https://github.com/a/b.git/')).toBe('https://github.com/a/b');
  });

  it('normalizes authors, pages and install URLs', () => {
    expect(pluginAuthor({ author: { name: 'AstrBot' } })).toBe('AstrBot');
    expect(pluginPages({ pages: ['main', { page_name: 'settings' }] })).toEqual(['main', 'settings']);
    expect(pluginInstallUrl({ download_url: 'https://example.com/plugin.zip' })).toContain('plugin.zip');
  });

  it('searches across title, id, author and description', () => {
    expect(filterPlugins([{ name: 'weather', author: 'Alice', desc: 'Forecast' }], 'alice')).toHaveLength(1);
  });

  it('indexes Chinese marketplace metadata for full-pinyin and initials search', async () => {
    const plugins = await addPluginPinyinSearchIndex([{ display_name: '天气助手', name: 'weather' }]);
    expect(filterPlugins(plugins, 'tianqizhushou')).toHaveLength(1);
    expect(filterPlugins(plugins, 'tqzs')).toHaveLength(1);
  });

  it('uses plugin locale metadata and unwraps README content', () => {
    const plugin = {
      name: 'weather',
      desc: 'Forecast',
      i18n: { 'zh-CN': { metadata: { display_name: '天气', desc: '天气预报' } } },
    };
    expect(localizedPluginTitle(plugin, 'zh-CN')).toBe('天气');
    expect(localizedPluginDescription(plugin, 'zh_CN')).toBe('天气预报');
    expect(
      localizedPluginConfigText(
        { 'zh-CN': { config: { weather: { city: { description: '城市' } } } } },
        'zh-CN',
        'weather.city',
        'description',
        'City',
      ),
    ).toBe('城市');
    expect(markdownContent({ content: '# README' })).toBe('# README');
  });

  it('normalizes the keyed marketplace response used by the legacy dashboard', () => {
    const payload = {
      $meta: { name: 'AstrBot', total: 2 },
      astrbot_plugin_weather: { author: 'Alice', desc: 'Forecast' },
      'Bob/astrbot_plugin_search': { author: 'Bob', name: 'astrbot_plugin_search' },
    };
    const plugins = marketPluginList(payload);
    expect(plugins.map(pluginId)).toEqual(['astrbot_plugin_weather', 'astrbot_plugin_search']);
    expect(plugins[0].market_plugin_id).toBe('Alice/astrbot_plugin_weather');
    expect(marketPluginTotal(payload, plugins.length)).toBe(2);
  });

  it('reproduces marketplace display, category, sorting and installed matching', () => {
    const market = [
      {
        author: 'Bob',
        category: 'AI Tools',
        market_plugin_id: 'Bob/astrbot_plugin_search',
        name: 'astrbot_plugin_search',
        pinned: true,
        repo: 'https://github.com/b/search',
        stars: 2,
      },
      {
        author: 'Alice',
        category: 'utilities',
        name: 'astrbot_plugin_weather',
        repo: 'https://github.com/a/weather.git',
        stars: 9,
      },
    ];
    expect(marketPluginDisplayName(market[0])).toBe('search');
    expect(marketCategoryCounts(market).get('ai_tools')).toBe(1);
    expect(sortMarketPlugins(market, 'stars', 'desc').map(pluginId)).toEqual([
      'astrbot_plugin_weather',
      'astrbot_plugin_search',
    ]);
    expect(
      markInstalledMarketPlugins(market, [{ name: 'weather', repo: 'https://github.com/a/weather' }], '')[1].installed,
    ).toBe(true);
  });
});

import { isObject, objectList, recordId } from '@/routes/configuration/model';
import type { PluginDto } from '@/api/domain';

export function pluginId(item: PluginDto) {
  return recordId(item, 'name', 'id', 'plugin_id', 'module_name', 'dir_name');
}

export function pluginTitle(item: PluginDto) {
  return String(item.display_name || item.title || item.name || item.id || 'Plugin');
}

export function pluginDescription(item: PluginDto) {
  return String(item.desc || item.description || '');
}

function nestedText(source: unknown, path: string) {
  if (!isObject(source)) return '';
  let current: unknown = source;
  for (const key of path.split('.')) {
    if (!isObject(current)) return '';
    current = current[key];
  }
  return typeof current === 'string' ? current : '';
}

function pluginLocaleData(item: PluginDto, language: string) {
  if (!isObject(item.i18n)) return undefined;
  const normalized = language.replace('_', '-');
  const short = normalized.split('-')[0];
  const candidates = [normalized, short].map((value) => value.toLowerCase());
  return Object.entries(item.i18n).find(([key]) => candidates.includes(key.replace('_', '-').toLowerCase()))?.[1];
}

export function localizedPluginTitle(item: PluginDto, language: string) {
  return nestedText(pluginLocaleData(item, language), 'metadata.display_name') || pluginTitle(item);
}

export function localizedPluginDescription(item: PluginDto, language: string) {
  return nestedText(pluginLocaleData(item, language), 'metadata.desc') || pluginDescription(item);
}

export function localizedPluginConfigText(i18n: unknown, language: string, path: string, field: 'description' | 'hint', fallback = '') {
  return nestedText(pluginLocaleData({ i18n }, language), `config.${path}.${field}`) || fallback;
}

export function markdownContent(value: unknown) {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return '';
  return typeof value.content === 'string' ? value.content : '';
}

export function pluginAuthor(item: PluginDto) {
  const author = item.author;
  if (Array.isArray(author)) return author.join(', ');
  if (isObject(author)) return String(author.name || author.login || '');
  return String(author || '');
}

export function pluginList(data: unknown): PluginDto[] {
  return objectList(data, ['plugins', 'items', 'data', 'results']);
}

export function marketPluginList(data: unknown): PluginDto[] {
  const list = pluginList(data);
  if (list.length || Array.isArray(data)) return list;
  if (!isObject(data)) return [];
  return Object.entries(data).flatMap(([key, value]) => {
    if (key === '$meta' || !isObject(value)) return [];
    const fallbackName = key.includes('/') ? '' : key.trim();
    const name = String(value.name || '').trim() || fallbackName;
    const author = pluginAuthor(value).trim();
    return [{
      ...value,
      name: name || key,
      market_plugin_id: String(value.market_plugin_id || '').trim() || (author && name ? `${author}/${name}` : ''),
    } satisfies PluginDto];
  });
}

export function marketPluginTotal(data: unknown, fallback: number) {
  if (!isObject(data)) return fallback;
  const meta = isObject(data.$meta) ? data.$meta : {};
  const pagination = isObject(data.pagination) ? data.pagination : {};
  for (const value of [data.total, data.total_count, meta.total, meta.total_count, pagination.total]) {
    const total = Number(value);
    if (Number.isFinite(total) && total >= 0) return total;
  }
  return fallback;
}

export function sourceList(data: unknown) {
  return objectList(data, ['sources', 'items', 'data']);
}

export function normalizePluginUrl(value: unknown) {
  return String(value || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

export function pluginInstallUrl(item: PluginDto) {
  return String(item.download_url || item.repo || item.repo_url || item.repository || item.url || '').trim();
}

export function pluginPages(item: PluginDto): string[] {
  const pages = item.pages;
  if (!Array.isArray(pages)) return [];
  return pages.map((page) => isObject(page) ? String(page.name || page.page_name || page.id || '') : String(page || '')).filter(Boolean);
}

export function filterPlugins(items: PluginDto[], query: string) {
  const term = query.trim().toLowerCase();
  if (!term) return items;
  const loose = term.replace(/[\s_-]+/g, '');
  return items.filter((item) => {
    const fields = [
      pluginTitle(item), pluginId(item), pluginAuthor(item), pluginDescription(item), item.short_desc, item.repo,
      item.version, item.astrbot_version, ...(Array.isArray(item.tags) ? item.tags : []),
      ...(Array.isArray(item.support_platforms) ? item.support_platforms : []), item.search_pinyin, item.search_initials,
    ].map(String);
    return fields.some((field) => {
      const normalized = field.toLowerCase();
      return normalized.includes(term) || normalized.replace(/[\s_-]+/g, '').includes(loose);
    });
  });
}

export async function addPluginPinyinSearchIndex(items: PluginDto[]) {
  if (!items.some((item) => /\p{Unified_Ideograph}/u.test([
    pluginTitle(item), pluginAuthor(item), pluginDescription(item), item.short_desc,
  ].map(String).join(' ')))) return items;
  const { pinyin } = await import('pinyin-pro');
  return items.map((item) => {
    const text = [
      pluginTitle(item), pluginId(item), pluginAuthor(item), pluginDescription(item), item.short_desc,
      ...(Array.isArray(item.tags) ? item.tags : []),
    ].map(String).join(' ');
    if (!/\p{Unified_Ideograph}/u.test(text)) return item;
    return {
      ...item,
      search_initials: pinyin(text, { pattern: 'first', toneType: 'none' }).replace(/\s+/g, '').toLowerCase(),
      search_pinyin: pinyin(text, { toneType: 'none' }).replace(/\s+/g, '').toLowerCase(),
    };
  });
}

export function categoryValue(item: PluginDto) {
  return String(item.category || objectList(item.categories, ['items'])[0]?.name || 'other');
}

export function marketPluginDisplayName(item: PluginDto, showFullName = false) {
  const displayName = String(item.display_name || '').trim();
  if (displayName) return displayName;
  const name = pluginTitle(item);
  if (showFullName) return name;
  return name.replace(/^astrbot[_-]plugin[_-]/i, '').replace(/^astrbot[_-]/i, '');
}

export function normalizeMarketCategory(value: unknown) {
  return String(value || 'other').trim().toLowerCase().replace(/[\s-]+/g, '_') || 'other';
}

export function marketCategoryCounts(items: PluginDto[]) {
  const counts = new Map<string, number>([['all', items.length]]);
  items.forEach((item) => {
    const category = normalizeMarketCategory(categoryValue(item));
    counts.set(category, (counts.get(category) || 0) + 1);
  });
  return counts;
}

export function sortMarketPlugins(items: PluginDto[], sort: 'default' | 'stars' | 'author' | 'updated', order: 'asc' | 'desc') {
  const direction = order === 'desc' ? -1 : 1;
  const plugins = [...items];
  if (sort === 'default') return [...plugins.filter((item) => Boolean(item.pinned)), ...plugins.filter((item) => !item.pinned)];
  return plugins.sort((left, right) => {
    if (sort === 'stars') return (Number(left.stars || 0) - Number(right.stars || 0)) * direction;
    if (sort === 'updated') return (new Date(String(left.updated_at || 0)).getTime() - new Date(String(right.updated_at || 0)).getTime()) * direction;
    return pluginAuthor(left).localeCompare(pluginAuthor(right), undefined, { sensitivity: 'base' }) * direction;
  });
}

export function markInstalledMarketPlugins(market: PluginDto[], installed: PluginDto[], registryUrl: string) {
  const registry = normalizePluginUrl(registryUrl);
  const identifiers = new Map<string, PluginDto>();
  const repos = new Map<string, PluginDto>();
  const names = new Map<string, PluginDto>();
  installed.forEach((item) => {
    const source = isObject(item.install_source) ? item.install_source : {};
    if (source.install_method === 'market' && normalizePluginUrl(source.registry_url) === registry && source.market_plugin_id) identifiers.set(String(source.market_plugin_id), item);
    const repo = normalizePluginUrl(item.repo || source.repo);
    if (repo) repos.set(repo, item);
    else names.set(String(item.marketplace_name || pluginId(item)).trim().toLowerCase(), item);
  });
  const marked = market.map((item) => {
    const repo = normalizePluginUrl(item.repo || item.repo_url);
    const match = identifiers.get(String(item.market_plugin_id || '')) || (repo ? repos.get(repo) : undefined) || names.get(pluginId(item).toLowerCase());
    return {
      ...item,
      astrbot_version: item.astrbot_version || match?.astrbot_version,
      installed: Boolean(match),
      support_platforms: Array.isArray(item.support_platforms) && item.support_platforms.length ? item.support_platforms : match?.support_platforms,
    };
  });
  return [...marked.filter((item) => !item.installed), ...marked.filter((item) => item.installed)];
}

import { isObject, type JsonObject } from '@/routes/configuration/model';

export function getSelectedGitHubProxy(storage: Storage | null = typeof window === 'undefined' ? null : window.localStorage) {
  if (!storage || storage.getItem('githubProxyRadioValue') !== '1') return '';
  return storage.getItem('selectedGitHubProxy') || '';
}

export function pluginUpdateTargets(items: JsonObject[]) {
  return items.filter((item) => Boolean(item.has_update)).map((item) => String(item.name || item.id || '')).filter(Boolean);
}

function normalizeUrl(value: unknown) {
  return String(value || '').trim().replace(/\/+$/, '').replace(/\.git$/i, '').toLowerCase();
}

function versionParts(value: unknown) {
  return String(value || '').trim().replace(/^v/i, '').split(/[+-]/)[0].split('.').map((part) => Number.parseInt(part.match(/^\d+/)?.[0] || '0', 10));
}

function compareVersions(left: unknown, right: unknown) {
  const leftParts = versionParts(left); const rightParts = versionParts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length, 3); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function annotatePluginUpdates(items: JsonObject[], markets: Map<string, JsonObject[]>) {
  return items.map((item) => {
    const next = { ...item, has_update: false, online_version: '' };
    const source = isObject(item.install_source) ? item.install_source : {};
    if (!item.updates_enabled || source.implicit === true || source.install_method !== 'market') return next;
    const registry = normalizeUrl(source.registry_url);
    const candidates = markets.get(registry) || [];
    const sourceId = String(source.market_plugin_id || '').trim();
    const sourceRepo = normalizeUrl(source.repo || item.repo);
    const marketplaceName = String(item.marketplace_name || '').trim().toLowerCase();
    const match = candidates.find((candidate) => (
      sourceId && String(candidate.market_plugin_id || candidate.id || '').trim() === sourceId
    ) || (
      sourceRepo && normalizeUrl(candidate.repo || candidate.download_url) === sourceRepo
    ) || (
      marketplaceName && String(candidate.name || '').trim().toLowerCase() === marketplaceName
    ));
    if (!match) return next;
    const localVersion = String(item.version || '').trim();
    const onlineVersion = String(match.version || '').trim();
    const known = /^v?\d+/.test(localVersion) && /^v?\d+/.test(onlineVersion);
    const comparison = known ? compareVersions(localVersion, onlineVersion) : 0;
    return {
      ...next,
      has_update: known && (comparison < 0 || comparison === 0 && localVersion.includes('-') && !onlineVersion.includes('-')),
      online_version: onlineVersion,
      update_market_plugin: match,
    };
  });
}

export function pluginBatchUpdateFailures(response: unknown) {
  const envelope = isObject((response as { data?: unknown } | null)?.data)
    ? (response as { data: JsonObject }).data
    : {};
  const payload = isObject(envelope.data) ? envelope.data : {};
  const results = Array.isArray(payload.results) ? payload.results.filter(isObject) : [];
  return {
    envelope,
    failures: results.filter((result) => result.status !== 'ok'),
  };
}

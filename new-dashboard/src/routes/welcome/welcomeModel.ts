import { isRecord } from '@/api/response';

export type ComputerAccessRuntime = 'local' | 'none';

export function hasChatProvider(payload: unknown) {
  return chatProviders(payload).length > 0;
}

export function chatProviders(payload: unknown) {
  if (!isRecord(payload)) return [];
  const sourceValue = payload.provider_sources ?? payload.providerSources;
  const sources = Array.isArray(sourceValue) ? sourceValue.filter(isRecord) : [];
  const providers = Array.isArray(payload.providers) ? payload.providers.filter(isRecord) : [];
  const sourceTypes = new Map(sources.map((source) => [
    typeof source.id === 'string' ? source.id : '',
    typeof source.provider_type === 'string' ? source.provider_type : '',
  ]));
  return providers.filter((provider) => (
    provider.provider_type === 'chat_completion'
    || sourceTypes.get(typeof provider.provider_source_id === 'string' ? provider.provider_source_id : '') === 'chat_completion'
    || String(provider.type ?? '').includes('chat_completion')
  ));
}

export function pickDefaultProviderId(payload: unknown) {
  const providers = chatProviders(payload);
  return (providers.find((provider) => provider.enable !== false) ?? providers[0])?.id ?? '';
}

export function normalizeComputerAccessRuntime(value: unknown): ComputerAccessRuntime {
  return value === 'local' || value === 'sandbox' ? 'local' : 'none';
}

export function isComputerAccessRuntimeConfigured(value: unknown) {
  return value === 'local' || value === 'none' || value === 'sandbox';
}

export function resolveWelcomeAnnouncement(raw: unknown, locale: string) {
  if (typeof raw === 'string') return raw.trim();
  if (!isRecord(raw)) return '';
  const values = raw;
  const normalized = locale.replace('-', '_');
  const keys = normalized.startsWith('zh')
    ? [normalized, 'zh_CN', 'zh-CN', 'zh', 'en_US', 'en-US', 'en']
    : [normalized, 'en_US', 'en-US', 'en', 'zh_CN', 'zh-CN', 'zh'];
  for (const key of keys) {
    const value = values[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export function greetingPeriod(date = new Date()) {
  const hour = date.getHours();
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
}

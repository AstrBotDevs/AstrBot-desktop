export type ComputerAccessRuntime = 'local' | 'none';

export function unwrapApiData<T>(response: unknown): T | undefined {
  const axiosData = (response as { data?: unknown } | null)?.data;
  if (!axiosData || typeof axiosData !== 'object') return axiosData as T | undefined;
  return ((axiosData as { data?: unknown }).data ?? axiosData) as T;
}

export function hasChatProvider(payload: unknown) {
  const data = payload as {
    provider_sources?: Array<{ id?: string; provider_type?: string }>;
    providers?: Array<{ provider_source_id?: string; provider_type?: string; type?: string }>;
  } | undefined;
  const sourceTypes = new Map((data?.provider_sources ?? []).map((source) => [source.id, source.provider_type]));
  return (data?.providers ?? []).some((provider) => (
    provider.provider_type === 'chat_completion'
    || sourceTypes.get(provider.provider_source_id) === 'chat_completion'
    || String(provider.type ?? '').includes('chat_completion')
  ));
}

export function normalizeComputerAccessRuntime(value: unknown): ComputerAccessRuntime {
  return value === 'local' || value === 'sandbox' ? 'local' : 'none';
}

export function isComputerAccessRuntimeConfigured(value: unknown) {
  return value === 'local' || value === 'none' || value === 'sandbox';
}

export function resolveWelcomeAnnouncement(raw: unknown, locale: string) {
  if (typeof raw === 'string') return raw.trim();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const values = raw as Record<string, unknown>;
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

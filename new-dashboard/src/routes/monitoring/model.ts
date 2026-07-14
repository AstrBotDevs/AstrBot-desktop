export type LogItem = {
  action?: string;
  data?: string;
  fields?: unknown;
  level?: string;
  message_outline?: string;
  sender_name?: string;
  span_id?: string;
  time?: number;
  type?: string;
  umo?: string;
};

export function unwrapData<T>(response: unknown): T | undefined {
  const data = (response as { data?: unknown } | null)?.data;
  if (!data || typeof data !== 'object') return data as T | undefined;
  return ((data as { data?: unknown }).data ?? data) as T;
}

export function parseSseChunk(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const boundary = normalized.lastIndexOf('\n\n');
  if (boundary < 0) return { events: [] as string[], remainder: normalized };
  const complete = normalized.slice(0, boundary);
  const remainder = normalized.slice(boundary + 2);
  const events = complete.split('\n\n').map((block) => block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n'))
    .filter(Boolean);
  return { events, remainder };
}

export function logIdentity(log: LogItem) {
  return `${log.time ?? ''}:${log.level ?? ''}:${log.type ?? ''}:${log.span_id ?? ''}:${log.action ?? ''}:${log.data ?? ''}`;
}

export function formatTimestamp(value: unknown, locale?: string) {
  if (value == null || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(locale);
}

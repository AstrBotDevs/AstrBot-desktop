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

export function parseSseChunk(buffer: string) {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const boundary = normalized.lastIndexOf('\n\n');
  if (boundary < 0) return { events: [] as string[], remainder: normalized };
  const complete = normalized.slice(0, boundary);
  const remainder = normalized.slice(boundary + 2);
  const events = complete
    .split('\n\n')
    .map((block) =>
      block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n'),
    )
    .filter(Boolean);
  return { events, remainder };
}

export function logIdentity(log: LogItem) {
  return `${log.time ?? ''}:${log.level ?? ''}:${log.type ?? ''}:${log.span_id ?? ''}:${log.action ?? ''}:${log.data ?? ''}`;
}

// Terminal escape matching intentionally includes ASCII control characters.
// eslint-disable-next-line no-control-regex
const ansiOscPattern = /\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g;
// eslint-disable-next-line no-control-regex
const ansiCsiPattern = /(?:\u001B\[|\u009B|\uFFFD\[|\\u001b\[|\\x1b\[)[0-?]*[ -/]*[@-~]/gi;
// eslint-disable-next-line no-control-regex
const ansiCharsetPattern = /\u001B[()][0-2A-Z]/g;

/**
 * Logs normally contain ANSI color escapes. Some Windows log paths decode the
 * ESC byte as U+FFFD before it reaches the browser, producing text such as
 * `�[1;36m`. The legacy console removed the color prefix and reset marker
 * before rendering, so accept both representations here.
 */
export function cleanConsoleLog(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return (text ?? '').replace(ansiOscPattern, '').replace(ansiCsiPattern, '').replace(ansiCharsetPattern, '');
}

export function splitConsoleLog(value: unknown) {
  const text = cleanConsoleLog(value);
  const match = text.match(/\[(DEBG|INFO|WARN|ERRO|CRIT|DEBUG|WARNING|ERROR|CRITICAL)\]/);
  if (!match || match.index == null) return { message: text, prefix: '', level: '' };
  const levelEnd = match.index + match[0].length;
  return {
    level: match[0],
    message: text.slice(levelEnd).trimStart(),
    prefix: text.slice(0, match.index).trimEnd(),
  };
}

export function formatTimestamp(value: unknown, locale?: string) {
  if (value == null || value === '') return '—';
  const numeric = typeof value === 'number' ? value : Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString(locale);
}

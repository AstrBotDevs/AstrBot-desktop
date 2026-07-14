import type { LogItem } from './model';

export type TraceEvent = {
  firstTime: number;
  lastTime: number;
  messageOutline?: string;
  records: Array<{ action: string; fields: unknown; key: string; time: number }>;
  senderName?: string;
  spanId: string;
  umo?: string;
};

export function groupTraceEvents(logs: LogItem[], maxItems = 300): TraceEvent[] {
  const events = new Map<string, TraceEvent>();
  logs.forEach((log) => {
    if (log.type !== 'trace' || !log.span_id) return;
    const time = log.time ?? 0;
    const event = events.get(log.span_id) ?? {
      firstTime: time,
      lastTime: time,
      messageOutline: log.message_outline,
      records: [],
      senderName: log.sender_name,
      spanId: log.span_id,
      umo: log.umo,
    };
    const key = `${time}:${log.action ?? ''}`;
    if (!event.records.some((record) => record.key === key)) {
      event.records.push({ action: log.action ?? '', fields: log.fields, key, time });
    }
    event.firstTime = Math.min(event.firstTime, time);
    event.lastTime = Math.max(event.lastTime, time);
    event.messageOutline ||= log.message_outline;
    event.senderName ||= log.sender_name;
    events.set(log.span_id, event);
  });
  return [...events.values()]
    .map((event) => ({ ...event, records: event.records.sort((a, b) => b.time - a.time) }))
    .sort((a, b) => b.firstTime - a.firstTime)
    .slice(0, maxItems);
}

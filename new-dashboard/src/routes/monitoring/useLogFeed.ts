import { useEffect, useState } from 'react';

import { getLogHistory } from '@/api/openapi';
import { readAuthToken } from '@/auth/storage';
import { logIdentity, parseSseChunk, unwrapData, type LogItem } from './model';

const delay = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = window.setTimeout(resolve, milliseconds);
  signal.addEventListener('abort', () => { window.clearTimeout(timer); resolve(); }, { once: true });
});

export function useLogFeed(predicate: (log: LogItem) => boolean, maxItems = 300, reconnectKey = 0) {
  const [items, setItems] = useState<LogItem[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'stopped'>('connecting');

  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    const append = (incoming: LogItem[]) => setItems((current) => {
      const seen = new Set(current.map(logIdentity));
      const merged = [...current];
      incoming.filter(predicate).forEach((item) => {
        const key = logIdentity(item);
        if (!seen.has(key)) { seen.add(key); merged.push(item); }
      });
      return merged.sort((a, b) => (a.time ?? 0) - (b.time ?? 0)).slice(-maxItems);
    });

    const loadHistory = async () => {
      const payload = unwrapData<{ logs?: LogItem[] }>(await getLogHistory());
      append(payload?.logs ?? []);
    };

    const connect = async () => {
      let attempt = 0;
      await loadHistory().catch(() => undefined);
      while (!controller.signal.aborted && attempt < 10) {
        try {
          setStatus('connecting');
          const token = readAuthToken();
          const response = await fetch('/api/v1/logs/live', {
            credentials: 'include',
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
            signal: controller.signal,
          });
          if (!response.ok || !response.body) throw new Error(`Log stream failed: ${response.status}`);
          setStatus('live');
          attempt = 0;
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          while (!controller.signal.aborted) {
            const result = await reader.read();
            if (result.done) break;
            buffer += decoder.decode(result.value, { stream: true });
            const parsed = parseSseChunk(buffer);
            buffer = parsed.remainder;
            append(parsed.events.flatMap((event) => {
              try { return [JSON.parse(event) as LogItem]; } catch { return []; }
            }));
          }
        } catch {
          if (controller.signal.aborted) break;
        }
        attempt += 1;
        await delay(Math.min(1000 * 2 ** (attempt - 1), 30_000), controller.signal);
      }
      if (!controller.signal.aborted) setStatus('stopped');
    };
    void connect();
    return () => controller.abort();
  }, [maxItems, predicate, reconnectKey]);

  return { items, status };
}

import { useEffect, useState } from 'react';

import { getLogHistory } from '@/api/openapi';
import { responseData } from '@/api/response';
import { fetchWithAuth } from '@/api/http';
import { apiEndpoints } from '@/config/endpoints';
import { logIdentity, parseSseChunk, type LogItem } from './model';

const delay = (milliseconds: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });

export function useLogFeed(predicate: (log: LogItem) => boolean, maxItems = 300, reconnectKey = 0) {
  const [items, setItems] = useState<LogItem[]>([]);
  const [status, setStatus] = useState<'connecting' | 'live' | 'stopped'>('connecting');

  useEffect(() => {
    const controller = new AbortController();
    let flushTimer: number | undefined;
    let pending: LogItem[] = [];
    setItems([]);
    const flush = () => {
      flushTimer = undefined;
      const incoming = pending;
      pending = [];
      if (!incoming.length || controller.signal.aborted) return;
      setItems((current) => {
        const seen = new Set(current.map(logIdentity));
        const merged = [...current];
        let lastTime = merged.at(-1)?.time ?? Number.NEGATIVE_INFINITY;
        let requiresSort = false;
        incoming.forEach((item) => {
          const key = logIdentity(item);
          if (seen.has(key)) return;
          seen.add(key);
          const itemTime = item.time ?? 0;
          if (itemTime < lastTime) requiresSort = true;
          lastTime = Math.max(lastTime, itemTime);
          merged.push(item);
        });
        if (merged.length === current.length) return current;
        if (requiresSort) merged.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
        return merged.slice(-maxItems);
      });
    };
    const append = (incoming: LogItem[]) => {
      pending.push(...incoming.filter(predicate));
      // Coalesce bursty SSE chunks so rendering and terminal scrolling happen at
      // most a few times per second instead of once per network chunk.
      flushTimer ??= window.setTimeout(flush, 80);
    };

    const loadHistory = async () => {
      const payload = responseData<{ logs?: LogItem[] }>(await getLogHistory());
      append(payload?.logs ?? []);
    };

    const connect = async () => {
      let attempt = 0;
      await loadHistory().catch(() => undefined);
      while (!controller.signal.aborted && attempt < 10) {
        try {
          setStatus('connecting');
          const response = await fetchWithAuth(apiEndpoints.liveLogs, {
            credentials: 'include',
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
            append(
              parsed.events.flatMap((event) => {
                try {
                  return [JSON.parse(event) as LogItem];
                } catch {
                  return [];
                }
              }),
            );
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
    return () => {
      controller.abort();
      if (flushTimer !== undefined) window.clearTimeout(flushTimer);
      pending = [];
    };
  }, [maxItems, predicate, reconnectKey]);

  return { items, status };
}

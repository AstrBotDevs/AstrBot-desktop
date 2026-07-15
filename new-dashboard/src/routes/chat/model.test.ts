import { describe, expect, it } from 'vitest';
import { appendStreamPayload, normalizeRecord, parseSseEvents, sessionList } from './model';

describe('chat model', () => {
  it('normalizes stored history and appends streaming text', () => {
    const record = normalizeRecord({ sender_id: 'bot', content: { message: 'Hello' } });
    appendStreamPayload(record, { type: 'plain', data: ' world', streaming: true });
    expect(record.content.type).toBe('bot');
    expect(record.content.message[0].text).toBe('Hello world');
  });

  it('parses complete SSE events and preserves an incomplete event', () => {
    const result = parseSseEvents('data: {"type":"plain","data":"A"}\n\ndata: {"type"');
    expect(result.payloads).toEqual([{ type: 'plain', data: 'A' }]);
    expect(result.remainder).toBe('data: {"type"');
  });

  it('accepts list and envelope session shapes', () => {
    expect(sessionList([{ session_id: 'a' }])).toHaveLength(1);
    expect(sessionList({ sessions: [{ session_id: 'b' }] })[0].session_id).toBe('b');
  });
});

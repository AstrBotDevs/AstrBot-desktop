import { describe, expect, it } from 'vitest';
import { appendStreamPayload, contextTokenCount, normalizeRecord, parseSseEvents, sessionList, stagedAttachmentType } from './model';

describe('chat model', () => {
  it('uses current context tokens before accumulated provider usage', () => {
    expect(contextTokenCount({
      current_context_tokens: 1_100,
      token_usage: { input_other: 1_050, input_cached: 1_000, output: 50 },
    })).toBe(1_100);
  });

  it('falls back to provider usage when current context tokens are absent', () => {
    expect(contextTokenCount({
      token_usage: { input_other: 1_050, input_cached: 1_000, output: 50 },
    })).toBe(2_100);
  });

  it('classifies recorded audio as a record attachment', () => {
    expect(stagedAttachmentType('record', 'application/octet-stream')).toBe('record');
    expect(stagedAttachmentType(undefined, 'audio/webm;codecs=opus')).toBe('record');
    expect(stagedAttachmentType(undefined, 'image/png')).toBe('image');
  });

  it('normalizes stored history and appends streaming text', () => {
    const record = normalizeRecord({ sender_id: 'bot', content: { message: 'Hello' } });
    appendStreamPayload(record, { type: 'plain', data: ' world', streaming: true });
    appendStreamPayload(record, { type: 'plain', data: { content: '!' }, streaming: true });
    expect(record.content.type).toBe('bot');
    expect(record.content.message[0].text).toBe('Hello world!');
  });

  it('merges streaming reasoning chunks', () => {
    const record = normalizeRecord({ sender_id: 'bot', content: { message: [] } });
    appendStreamPayload(record, { type: 'plain', chain_type: 'reasoning', data: { message: 'Step ' } });
    appendStreamPayload(record, { type: 'plain', chain_type: 'reasoning', data: { text: 'one' } });
    expect(record.content.reasoning).toBe('Step one');
    expect(record.content.message).toEqual([{ type: 'think', think: 'Step one' }]);
  });

  it('preserves historical and streaming agent statistics', () => {
    const record = normalizeRecord({ sender_id: 'bot', content: { message: [], agent_stats: { token_usage: { output: 3 } } } });
    expect(record.content.agentStats).toEqual({ token_usage: { output: 3 } });
    appendStreamPayload(record, { type: 'agent_stats', data: { duration: 1.2 } });
    expect(record.content.agentStats).toEqual({ duration: 1.2 });
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

import { describe, expect, it } from 'vitest';
import {
  agentRunnerTypeFromProfile,
  appendStreamPayload,
  contextTokenCount,
  normalizeRecord,
  serializeChatParts,
  stagedAttachmentType,
  usesLocalProviderOverride,
} from './model';

describe('chat model', () => {
  it('uses current context tokens before accumulated provider usage', () => {
    expect(
      contextTokenCount({
        current_context_tokens: 1_100,
        token_usage: { input_other: 1_050, input_cached: 1_000, output: 50 },
      }),
    ).toBe(1_100);
  });

  it('falls back to provider usage when current context tokens are absent', () => {
    expect(
      contextTokenCount({
        token_usage: { input_other: 1_050, input_cached: 1_000, output: 50 },
      }),
    ).toBe(2_100);
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
    const record = normalizeRecord({
      sender_id: 'bot',
      content: { message: [], agent_stats: { token_usage: { output: 3 } } },
    });
    expect(record.content.agentStats).toEqual({ token_usage: { output: 3 } });
    appendStreamPayload(record, { type: 'agent_stats', data: { duration: 1.2 } });
    expect(record.content.agentStats).toEqual({ duration: 1.2 });
  });

  it('merges tool calls with their streamed results', () => {
    const record = normalizeRecord({ sender_id: 'bot', content: { message: [] } });
    appendStreamPayload(record, {
      type: 'plain',
      chain_type: 'tool_call',
      data: { id: 'call-1', name: 'search', arguments: { query: 'AstrBot' } },
    });
    appendStreamPayload(record, {
      type: 'plain',
      chain_type: 'tool_call_result',
      data: { id: 'call-1', result: { count: 2 } },
    });
    expect(record.content.message).toHaveLength(1);
    expect(record.content.message[0].tool_calls).toEqual([
      expect.objectContaining({ id: 'call-1', name: 'search', result: { count: 2 }, status: 'completed' }),
    ]);
  });

  it('retains saved checkpoint and reference metadata', () => {
    const record = normalizeRecord({ sender_id: 'bot', content: { message: [] } });
    appendStreamPayload(record, {
      type: 'message_saved',
      data: { id: 9, llm_checkpoint_id: 'checkpoint-1', refs: { used: [{ title: 'Docs' }] } },
    });
    expect(record.id).toBe(9);
    expect(record.llm_checkpoint_id).toBe('checkpoint-1');
    expect(record.content.refs).toEqual({ used: [{ title: 'Docs' }] });
  });

  it('serializes reply, text, and attachment parts without dropping protocol fields', () => {
    expect(
      serializeChatParts([
        { type: 'reply', message_id: 9, selected_text: 'selected' },
        { type: 'plain', text: 'hello' },
        { type: 'file', attachment_id: 'attachment-1', filename: 'notes.txt' },
      ]),
    ).toEqual([
      { type: 'reply', message_id: 9, selected_text: 'selected' },
      { type: 'plain', text: 'hello' },
      { type: 'file', attachment_id: 'attachment-1', filename: 'notes.txt' },
    ]);
  });

  it('updates the corresponding user record from user_message_saved', () => {
    const bot = normalizeRecord({ sender_id: 'bot', content: { message: [] } });
    const user = normalizeRecord({
      id: 'local-user-1',
      sender_id: 'user',
      content: { message: [{ type: 'plain', text: 'hello' }] },
    });

    expect(
      appendStreamPayload(
        bot,
        {
          type: 'user_message_saved',
          data: { id: 7, created_at: '2026-07-17T00:00:00Z', llm_checkpoint_id: 'checkpoint-user' },
        },
        user,
      ),
    ).toBe(true);
    expect(user.id).toBe(7);
    expect(user.created_at).toBe('2026-07-17T00:00:00Z');
    expect(user.llm_checkpoint_id).toBe('checkpoint-user');
    expect(appendStreamPayload(bot, { type: 'user_message_saved', data: { id: 8 } })).toBe(false);
  });

  it('resolves agent runner type and local provider override behavior', () => {
    expect(
      agentRunnerTypeFromProfile({
        config: { provider_settings: { agent_runner_type: 'Internal' } },
      }),
    ).toBe('internal');
    expect(agentRunnerTypeFromProfile({ provider_settings: { agent_runner_type: 'dify' } })).toBe('dify');
    expect(agentRunnerTypeFromProfile({})).toBe('local');
    expect(usesLocalProviderOverride('local')).toBe(true);
    expect(usesLocalProviderOverride('INTERNAL')).toBe(true);
    expect(usesLocalProviderOverride('dify')).toBe(false);
  });
});

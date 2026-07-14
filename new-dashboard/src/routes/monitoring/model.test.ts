import { describe, expect, it } from 'vitest';

import { formatTimestamp, logIdentity, parseSseChunk, unwrapData } from './model';

describe('monitoring data helpers', () => {
  it('unwraps generated API envelopes', () => {
    expect(unwrapData({ data: { data: { value: 1 }, status: 'ok' } })).toEqual({ value: 1 });
  });

  it('parses complete SSE frames and preserves the remainder', () => {
    expect(parseSseChunk('data: {"a":1}\n\ndata: partial')).toEqual({
      events: ['{"a":1}'],
      remainder: 'data: partial',
    });
  });

  it('creates stable log identities and formats second timestamps', () => {
    expect(logIdentity({ data: 'message', level: 'INFO', time: 1 })).toContain('INFO');
    expect(formatTimestamp(0)).not.toBe('—');
  });
});

import { describe, expect, it } from 'vitest';
import { responseData } from '@/api/response';

import { cleanConsoleLog, formatTimestamp, logIdentity, parseSseChunk, splitConsoleLog } from './model';

describe('monitoring data helpers', () => {
  it('unwraps generated API envelopes', () => {
    expect(responseData({ data: { data: { value: 1 }, status: 'ok' } })).toEqual({ value: 1 });
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

  it('removes standard and replacement-character ANSI sequences from logs', () => {
    expect(cleanConsoleLog('\u001b[1;36mINFO\u001b[0m')).toBe('INFO');
    expect(cleanConsoleLog('\ufffd[1;36mINFO\ufffd[0m')).toBe('INFO');
    expect(cleanConsoleLog('\\x1b[31mERROR\\x1b[0m')).toBe('ERROR');
    expect(cleanConsoleLog('array[0] contains \ufffd text')).toBe('array[0] contains \ufffd text');
  });

  it('splits structured console lines into prefix, level, and message', () => {
    expect(splitConsoleLog('2026-07-17 10:00 [INFO] service started')).toEqual({
      level: '[INFO]',
      message: 'service started',
      prefix: '2026-07-17 10:00',
    });
  });

  it('preserves multiline ASCII art whitespace inside the message', () => {
    expect(splitConsoleLog('[2026-07-17 10:49:35.419] [Core] [INFO] [AstrBot.main:212]:\n    ASTRBOT')).toEqual({
      prefix: '[2026-07-17 10:49:35.419] [Core]',
      level: '[INFO]',
      message: '[AstrBot.main:212]:\n    ASTRBOT',
    });
  });
});

import { describe, expect, it } from 'vitest';
import { objectList, parseJsonObject, recordId, responseData } from './model';

describe('configuration model', () => {
  it('unwraps generated API envelopes', () => {
    expect(responseData({ data: { status: 'ok', data: { enabled: true } } })).toEqual({ enabled: true });
  });

  it('finds lists in known response fields', () => {
    expect(objectList({ providers: [{ id: 'p1' }] }, ['providers'])).toEqual([{ id: 'p1' }]);
    expect(recordId({ persona_id: 'helper' }, 'id', 'persona_id')).toBe('helper');
  });

  it('only accepts JSON objects', () => {
    expect(parseJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(() => parseJsonObject('[]')).toThrow('JSON root');
  });
});

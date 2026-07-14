import { describe, expect, it } from 'vitest';

import { groupTraceEvents } from './traceModel';

describe('trace grouping', () => {
  it('groups trace records by span and ignores duplicate records', () => {
    const record = { action: 'start', span_id: 'span', time: 2, type: 'trace' };
    const events = groupTraceEvents([record, record, { ...record, action: 'finish', time: 3 }]);
    expect(events).toHaveLength(1);
    expect(events[0].records).toHaveLength(2);
    expect(events[0].lastTime).toBe(3);
  });
});

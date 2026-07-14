import { describe, expect, it } from 'vitest';

import { formatRunningTime, makeSparklinePoints } from './statsModel';

describe('stats model', () => {
  it('normalizes chart values into an SVG polyline', () => {
    expect(makeSparklinePoints([[1, 10], [2, 20]], 100, 50)).toBe('0.0,50.0 100.0,0.0');
  });

  it('formats runtime counters', () => {
    expect(formatRunningTime({ hours: 1, minutes: 2, seconds: 3 })).toBe('1h 2m 3s');
  });
});

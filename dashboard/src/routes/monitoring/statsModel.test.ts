import { describe, expect, it } from 'vitest';

import { aggregateProviderSeries, formatRunningTime, makeSparklinePoints } from './statsModel';

describe('stats model', () => {
  it('normalizes chart values into an SVG polyline', () => {
    expect(
      makeSparklinePoints(
        [
          [1, 10],
          [2, 20],
        ],
        100,
        50,
        0,
      ),
    ).toBe('0.0,50.0 100.0,0.0');
  });

  it('formats runtime counters', () => {
    expect(formatRunningTime({ hours: 1, minutes: 2, seconds: 3 })).toBe('1h 2m 3s');
  });

  it('groups provider series beyond the first four into others', () => {
    const series = Array.from({ length: 6 }, (_, index) => ({
      name: `p${index}`,
      data: [[1, index + 1] as [number, number]],
      total_tokens: index + 1,
    }));
    const result = aggregateProviderSeries(series, 'Others');
    expect(result).toHaveLength(5);
    expect(result[4]).toMatchObject({ name: 'Others', data: [[1, 11]], total_tokens: 11 });
  });
});

import { describe, expect, it } from 'vitest';

const routeSources = import.meta.glob('../routes/**/*.{ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

describe('route translation keys', () => {
  it('uses dot-separated paths for the nested feature resources', () => {
    const invalidKeys = Object.entries(routeSources).flatMap(([path, source]) => {
      const matches = source.match(/features\/[a-z][\w-]*/gi) ?? [];
      return matches.map((key) => `${path}: ${key}`);
    });

    expect(invalidKeys).toEqual([]);
  });
});

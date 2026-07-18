import { describe, expect, it } from 'vitest';

import { createSafeStorage } from './safeStorage';

describe('safe storage adapter', () => {
  it('reads, writes, and removes values without exposing Storage exceptions', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    } as unknown as Storage;
    const safe = createSafeStorage(storage);
    expect(safe.set('key', 'value')).toBe(true);
    expect(safe.get('key')).toBe('value');
    safe.remove('key');
    expect(safe.get('key')).toBeNull();
  });

  it('recovers from unavailable storage', () => {
    const storage = {
      getItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    } as unknown as Storage;
    const safe = createSafeStorage(storage);
    expect(safe.get('key')).toBeNull();
    expect(safe.set('key', 'value')).toBe(false);
    expect(() => safe.remove('key')).not.toThrow();
  });
});

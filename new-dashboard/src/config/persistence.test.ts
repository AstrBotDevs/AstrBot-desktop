import { describe, expect, it } from 'vitest';

import { definePersistentValue, parseStringArray } from './persistence';

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key);
    },
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('versioned persistence', () => {
  const preference = definePersistentValue({
    fallback: [] as string[],
    key: 'items',
    parse: parseStringArray,
    version: 2,
  });

  it('writes a schema version with the validated value', () => {
    const storage = memoryStorage();
    preference.write(['one'], storage);
    expect(storage.getItem('items')).toBe('{"data":["one"],"version":2}');
    expect(preference.read(storage)).toEqual(['one']);
  });

  it('migrates a valid legacy value into the current envelope', () => {
    const storage = memoryStorage({ items: '["one","two"]' });
    expect(preference.read(storage)).toEqual(['one', 'two']);
    expect(storage.getItem('items')).toBe('{"data":["one","two"],"version":2}');
  });

  it.each(['not-json', '{"version":2,"data":[1]}', '{"version":99,"data":["future"]}'])(
    'removes dirty or unsupported data and recovers with the fallback: %s',
    (value) => {
      const storage = memoryStorage({ items: value });
      expect(preference.read(storage)).toEqual([]);
      expect(storage.getItem('items')).toBeNull();
    },
  );

  it('recovers when browser storage throws', () => {
    const storage = memoryStorage();
    storage.getItem = () => {
      throw new Error('denied');
    };
    expect(preference.read(storage)).toEqual([]);
  });
});

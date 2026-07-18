import { describe, expect, it } from 'vitest';

import { localeRegistry } from './locales';
import { translations } from './translations';

const routeSources = import.meta.glob('../routes/**/*.{ts,tsx}', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;
const uiSources = import.meta.glob('../{app,components,layouts,routes}/**/*.{ts,tsx}', {
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

function leafEntries(value: unknown, path = ''): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [[path, value]];
  return Object.entries(value).flatMap(([key, child]) => leafEntries(child, path ? `${path}.${key}` : key));
}

function translationValue(resource: unknown, key: string) {
  return key
    .split('.')
    .reduce<unknown>(
      (value, segment) =>
        value && typeof value === 'object' && segment in value
          ? (value as Record<string, unknown>)[segment]
          : undefined,
      resource,
    );
}

describe('locale resources', () => {
  it('keeps the registry and loaded resources in sync', () => {
    expect(Object.keys(translations).sort()).toEqual(localeRegistry.map(({ code }) => code).sort());
  });

  it('uses the same leaf keys in every supported locale', () => {
    const reference = leafEntries(translations['zh-CN'])
      .map(([key]) => key)
      .sort();

    for (const { code } of localeRegistry) {
      expect(
        leafEntries(translations[code])
          .map(([key]) => key)
          .sort(),
        `${code} translation keys`,
      ).toEqual(reference);
    }
  });

  it('does not contain empty translated values', () => {
    for (const { code } of localeRegistry) {
      const empty = leafEntries(translations[code])
        .filter(([, value]) => typeof value === 'string' && !value.trim())
        .map(([key]) => key);
      expect(empty, `${code} empty translations`).toEqual([]);
    }
  });

  it('defines every statically referenced UI key in each locale', () => {
    const references = Object.entries(uiSources).flatMap(([path, source]) => {
      const matches = source.matchAll(/\b(?:i18n\.)?t\(\s*(['"])([^'"`]+)\1/g);
      return Array.from(matches, ([, , key]) => ({ key, path })).filter(({ key }) => /^(core|features)\./.test(key));
    });

    for (const { code } of localeRegistry) {
      const missing = references
        .filter(({ key }) => translationValue(translations[code], key) === undefined)
        .map(({ key, path }) => `${path}: ${key}`);
      expect(missing, `${code} missing statically referenced keys`).toEqual([]);
    }
  });
});

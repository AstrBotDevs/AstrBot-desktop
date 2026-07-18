import { describe, expect, it } from 'vitest';

import {
  configItemsForValue,
  getConfigValue,
  inferConfigMetadata,
  matchesConfigCondition,
  setConfigValue,
} from './configFormModel';

describe('configuration form model', () => {
  it('reads and immutably writes dotted selectors', () => {
    const original = { dashboard: { ssl: { enable: false } } };
    const next = setConfigValue(original, 'dashboard.ssl.enable', true);

    expect(getConfigValue(next, 'dashboard.ssl.enable')).toBe(true);
    expect(original.dashboard.ssl.enable).toBe(false);
  });

  it('evaluates metadata conditions against the configuration root', () => {
    expect(
      matchesConfigCondition({ dashboard: { ssl: { enable: true } } }, { condition: { 'dashboard.ssl.enable': true } }),
    ).toBe(true);
  });

  it('infers useful controls for schema-less records', () => {
    const metadata = inferConfigMetadata({ enabled: true, retries: 2, tags: [] });
    expect(metadata.items?.enabled.type).toBe('bool');
    expect(metadata.items?.retries.type).toBe('int');
    expect(metadata.items?.tags.type).toBe('list');
  });

  it('selects only metadata fields present in the active template', () => {
    const selected = configItemsForValue(
      {
        items: {
          appid: { type: 'string' },
          secret: { type: 'string' },
          satori_api_base: { type: 'string' },
        },
      },
      { id: 'default', appid: '', secret: '', hint: 'ignored' },
    );

    expect(Object.keys(selected)).toEqual(['id', 'appid', 'secret']);
    expect(selected).not.toHaveProperty('satori_api_base');
  });
});

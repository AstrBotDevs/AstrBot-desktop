// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';

import { coreRouteModuleLoaders } from './coreRouteModules';

describe('core route smoke', () => {
  it.each(Object.entries(coreRouteModuleLoaders))('loads the page module registered for %s', async (_path, load) => {
    const module = await load();
    expect(module.default).toEqual(expect.any(Function));
  });
});

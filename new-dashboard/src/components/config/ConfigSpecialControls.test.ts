import { describe, expect, it } from 'vitest';

import { pluginSelectionMode, pluginSelectionValue, selectablePlugins } from './ConfigSpecialControls';

describe('plugin set selector migration', () => {
  it('maps persisted plugin sets to the legacy selection modes', () => {
    expect(pluginSelectionMode([])).toBe('none');
    expect(pluginSelectionMode(['*'])).toBe('all');
    expect(pluginSelectionMode(['weather', 'search'])).toBe('custom');
  });

  it('writes the same values as the legacy selector', () => {
    expect(pluginSelectionValue('all', ['weather'])).toEqual(['*']);
    expect(pluginSelectionValue('none', ['weather'])).toEqual([]);
    expect(pluginSelectionValue('custom', ['weather', 'search'])).toEqual(['weather', 'search']);
  });

  it('only lists activated non-system plugins sorted by internal name', () => {
    expect(selectablePlugins([
      { name: 'weather', activated: true, reserved: false },
      { name: 'admin', activated: true, reserved: true },
      { name: 'disabled', activated: false, reserved: false },
      { name: 'search', activated: true, reserved: false },
    ]).map((plugin) => plugin.name)).toEqual(['search', 'weather']);
  });
});

import { describe, expect, it } from 'vitest';

import {
  clampSidebarWidth,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  resolveDarkTheme,
  resolveInitialThemeMode,
} from './layout';

describe('layout state compatibility', () => {
  it('clamps sidebar resizing to the legacy width range', () => {
    expect(clampSidebarWidth(120)).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(250)).toBe(250);
    expect(clampSidebarWidth(420)).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('resolves light, dark, and system theme modes', () => {
    expect(resolveDarkTheme('light', true)).toBe(false);
    expect(resolveDarkTheme('dark', false)).toBe(true);
    expect(resolveDarkTheme('system', true)).toBe(true);
    expect(resolveDarkTheme('system', false)).toBe(false);
  });

  it('preserves the legacy uiTheme fallback when themeMode is absent', () => {
    expect(resolveInitialThemeMode(null, 'PurpleTheme')).toBe('light');
    expect(resolveInitialThemeMode(null, 'PurpleThemeDark')).toBe('dark');
    expect(resolveInitialThemeMode(null, null)).toBe('system');
  });
});

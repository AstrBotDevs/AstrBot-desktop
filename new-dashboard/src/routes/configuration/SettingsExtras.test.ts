import { describe, expect, it } from 'vitest';

import { formatBytes } from './SettingsExtras';

describe('settings extras', () => {
  it('formats storage sizes like the original dashboard', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
  });
});

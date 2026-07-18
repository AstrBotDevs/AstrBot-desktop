import { describe, expect, it } from 'vitest';

import { formatBackupDate, formatBytes } from './settingsExtrasModel';

describe('settings extras model', () => {
  it('formats storage sizes at readable unit boundaries', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
  });

  it('formats backup timestamps and ISO dates without assuming one wire format', () => {
    expect(formatBackupDate(0)).toBe(new Date(0).toLocaleString());
    expect(formatBackupDate(1_700_000_000)).toBe(new Date(1_700_000_000_000).toLocaleString());
    expect(formatBackupDate('2026-07-17T12:00:00.000Z')).toBe(new Date('2026-07-17T12:00:00.000Z').toLocaleString());
    expect(formatBackupDate('')).toBe('—');
  });
});

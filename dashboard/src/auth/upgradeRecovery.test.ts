import { describe, expect, it } from 'vitest';

import { normalizeVersion, restartPollDecision, versionsMismatch } from './upgradeRecovery';

describe('upgrade recovery model', () => {
  it('normalizes version prefixes before comparing', () => {
    expect(normalizeVersion(' v4.1.0 ')).toBe('4.1.0');
    expect(versionsMismatch('v4.1.0', '4.1.0')).toBe(false);
    expect(versionsMismatch('4.0.0', '4.1.0')).toBe(true);
  });

  it('detects restart completion and timeout without treating transient failures as success', () => {
    expect(restartPollDecision(100, null, 1)).toBe('continue');
    expect(restartPollDecision(100, 100, 89)).toBe('continue');
    expect(restartPollDecision(100, 101, 2)).toBe('reloaded');
    expect(restartPollDecision(100, 100, 90)).toBe('timeout');
  });
});

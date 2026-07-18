import { describe, expect, it } from 'vitest';

import { copiedConfigPayload, hasDuplicateConfigProfileName, normalizeConfigProfileName } from './configProfileModel';

describe('config profile operations', () => {
  it('normalizes and detects duplicate names while allowing the renamed source', () => {
    const profiles = [
      { id: 'default', name: 'default' },
      { id: 'work', name: 'Work' },
    ];
    expect(normalizeConfigProfileName('  copy  ')).toBe('copy');
    expect(hasDuplicateConfigProfileName(profiles, ' work ')).toBe(true);
    expect(hasDuplicateConfigProfileName(profiles, 'work', 'work')).toBe(false);
  });

  it('copies the complete source config including unknown fields', () => {
    const config = { known: true, future_field: { nested: 1 } };
    expect(copiedConfigPayload({ config, metadata: {} })).toEqual(config);
    expect(copiedConfigPayload(config)).toEqual(config);
  });
});

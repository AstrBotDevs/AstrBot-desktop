import { describe, expect, it } from 'vitest';

import { acquireActionLock } from './actionLock';

describe('action lock', () => {
  it('blocks re-entry until the active action releases the lock', () => {
    const lock = { current: false };
    const release = acquireActionLock(lock);

    expect(release).not.toBeNull();
    expect(acquireActionLock(lock)).toBeNull();

    release?.();
    expect(acquireActionLock(lock)).not.toBeNull();
  });

  it('allows an idempotent release', () => {
    const lock = { current: false };
    const release = acquireActionLock(lock);

    release?.();
    release?.();

    expect(lock.current).toBe(false);
  });
});

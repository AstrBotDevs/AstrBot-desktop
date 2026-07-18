import { describe, expect, it, vi } from 'vitest';

import { subscribeEvent } from './browserHooks';

describe('browser event lifecycle', () => {
  it('returns a cleanup that removes the exact listener', () => {
    const target = new EventTarget();
    const listener = vi.fn();
    const unsubscribe = subscribeEvent(target, 'change', listener);
    target.dispatchEvent(new Event('change'));
    unsubscribe();
    target.dispatchEvent(new Event('change'));
    expect(listener).toHaveBeenCalledOnce();
  });
});

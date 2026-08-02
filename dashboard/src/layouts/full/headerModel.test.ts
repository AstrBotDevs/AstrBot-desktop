import { describe, expect, it, vi } from 'vitest';

import { headerUpdateRuntime, runHeaderUpdateAction } from './headerModel';

describe('Header update runtime', () => {
  it('routes desktop and web update actions to different providers', () => {
    expect(headerUpdateRuntime(true)).toBe('desktop');
    expect(headerUpdateRuntime(false)).toBe('web');
  });

  it('calls only the action for the active runtime', async () => {
    const desktop = vi.fn(async () => 'desktop-result');
    const web = vi.fn(async () => 'web-result');

    await expect(runHeaderUpdateAction(true, desktop, web)).resolves.toBe('desktop-result');
    expect(desktop).toHaveBeenCalledOnce();
    expect(web).not.toHaveBeenCalled();

    desktop.mockClear();
    await expect(runHeaderUpdateAction(false, desktop, web)).resolves.toBe('web-result');
    expect(desktop).not.toHaveBeenCalled();
    expect(web).toHaveBeenCalledOnce();
  });
});

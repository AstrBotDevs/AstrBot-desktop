import { describe, expect, it, vi } from 'vitest';

import {
  getModeSwitchTarget,
  headerUpdateRuntime,
  LAST_BOT_ROUTE_KEY,
  LAST_CHAT_ROUTE_KEY,
  runHeaderUpdateAction,
} from './headerModel';

function storage(values: Record<string, string>): Pick<Storage, 'getItem'> {
  return { getItem: (key) => values[key] ?? null };
}

describe('Header mode switching', () => {
  it('returns to the last bot route from chat', () => {
    expect(getModeSwitchTarget('/chat/42', storage({ [LAST_BOT_ROUTE_KEY]: '/settings' }))).toBe('/settings');
  });

  it('returns to the last conversation from bot mode', () => {
    expect(getModeSwitchTarget('/settings', storage({ [LAST_CHAT_ROUTE_KEY]: '42' }))).toBe('/chat/42');
    expect(getModeSwitchTarget('/settings', storage({}))).toBe('/chat');
  });
});

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

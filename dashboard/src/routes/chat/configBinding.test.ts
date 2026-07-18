import { describe, expect, it } from 'vitest';

import { buildWebchatUmo, configRouteEntries, configRouteMatches, resolveChatConfigId } from './configBinding';

describe('chat config binding', () => {
  it('builds and resolves the same three-part UMO used by config routes', () => {
    const umo = buildWebchatUmo('session-1');
    expect(umo).toContain('webchat:FriendMessage:webchat!');
    expect(configRouteMatches('webchat:*:*', umo)).toBe(true);
    expect(
      resolveChatConfigId(
        [
          { pattern: 'other:*:*', configId: 'ignored' },
          { pattern: 'webchat:FriendMessage:*', configId: 'profile-1' },
        ],
        umo,
      ),
    ).toBe('profile-1');
  });

  it('normalizes routing response payloads', () => {
    expect(configRouteEntries({ routing: { '*:*:*': 'default', 'webchat:*:*': 'profile-2' } })).toEqual([
      { pattern: '*:*:*', configId: 'default' },
      { pattern: 'webchat:*:*', configId: 'profile-2' },
    ]);
  });
});

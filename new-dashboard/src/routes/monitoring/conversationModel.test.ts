import { describe, expect, it } from 'vitest';

import { conversationKey, parseConversationHistory, parseUmo } from './conversationModel';

describe('conversation model', () => {
  it('preserves colon characters in session IDs', () => {
    expect(parseUmo('telegram:FriendMessage:user:1')).toEqual({ messageType: 'FriendMessage', platform: 'telegram', sessionId: 'user:1' });
  });

  it('parses history JSON safely and creates composite keys', () => {
    expect(parseConversationHistory('[{"role":"user"}]')).toHaveLength(1);
    expect(parseConversationHistory('invalid')).toEqual([]);
    expect(conversationKey({ cid: 'c', user_id: 'u' })).toContain('c');
  });
});

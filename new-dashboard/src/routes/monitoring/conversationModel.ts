export type Conversation = {
  cid: string;
  created_at?: unknown;
  history?: string | unknown[];
  title?: string;
  updated_at?: unknown;
  user_id: string;
  umo_info?: Record<string, unknown>;
};
export type ConversationListData = {
  conversations?: Conversation[];
  pagination?: { page?: number; page_size?: number; total?: number; total_pages?: number };
};

export function conversationKey(item: Pick<Conversation, 'cid' | 'user_id'>) {
  return `${item.user_id}\u0000${item.cid}`;
}

export function parseUmo(userId: string) {
  const [platform = '', messageType = '', ...rest] = userId.split(':');
  return { messageType, platform, sessionId: rest.join(':') || userId };
}

export function parseConversationHistory(value: unknown): Array<Record<string, unknown>> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object')) : [];
  } catch { return []; }
}

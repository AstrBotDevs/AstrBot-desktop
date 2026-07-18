import { ApiPayloadError, expectRecord, isRecord, type UnknownRecord } from '@/api/response';

export type Conversation = {
  cid: string;
  created_at?: unknown;
  history?: string | unknown[];
  title?: string;
  updated_at?: unknown;
  user_id: string;
  umo_info?: UnknownRecord;
};
export type ConversationListData = {
  conversations?: Conversation[];
  pagination?: { page?: number; page_size?: number; total?: number; total_pages?: number };
};

export function parseConversation(value: unknown): Conversation {
  const item = expectRecord(value, 'conversation');
  return {
    ...item,
    cid: requiredText(item.cid, 'conversation.cid'),
    user_id: requiredText(item.user_id, 'conversation.user_id'),
    umo_info: isRecord(item.umo_info) ? item.umo_info : undefined,
  };
}

export function parseConversationList(value: unknown): ConversationListData {
  const payload = expectRecord(value, 'conversation list');
  const conversations = arrayValue(payload.conversations, 'conversation list.conversations')
    .map((item) => parseConversation(item));
  const pagination = isRecord(payload.pagination) ? payload.pagination : {};
  return {
    conversations,
    pagination: {
      page: numberValue(pagination.page),
      page_size: numberValue(pagination.page_size),
      total: numberValue(pagination.total) ?? conversations.length,
      total_pages: numberValue(pagination.total_pages) ?? 1,
    },
  };
}

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

function arrayValue(value: unknown, field: string) {
  if (!Array.isArray(value)) throw new ApiPayloadError(`Expected ${field} to be an array.`, value);
  return value;
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== 'string' || !value) {
    throw new ApiPayloadError(`Expected ${field} to be a non-empty string.`, value);
  }
  return value;
}

function numberValue(value: unknown) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export const apiEndpoints = {
  backup: (filename: string) => `/api/v1/backups/${encodeURIComponent(filename)}`,
  chat: '/api/v1/chat',
  conversationExport: '/api/v1/conversations/export',
  fileById: (id: string) => `/api/v1/files/${encodeURIComponent(id)}/content`,
  fileByName: (filename: string) => `/api/v1/files/content?filename=${encodeURIComponent(filename)}`,
  legacyChatAttachment: (id: string) => `/api/chat/attachment/${encodeURIComponent(id)}`,
  legacyChatFile: (filename: string) => `/api/chat/get_file?filename=${encodeURIComponent(filename)}`,
  liveLogs: '/api/v1/logs/live',
  pluginExtension: (pluginName: string, endpoint: string, query = '') =>
    `/api/v1/plugins/extensions/${encodeURIComponent(pluginName)}/${endpoint}${query}`,
  systemConfig: '/api/v1/system-config',
  regenerateChatMessage: (sessionId: string, messageId: string) =>
    `/api/v1/chat/sessions/${encodeURIComponent(sessionId)}/messages/${encodeURIComponent(messageId)}/regenerate`,
  threadMessages: (threadId: string) => `/api/v1/chat/threads/${encodeURIComponent(threadId)}/messages`,
  unifiedChatWebSocket: '/api/v1/unified-chat/ws',
} as const;

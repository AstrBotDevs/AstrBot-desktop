export const coreRouteModuleLoaders = {
  '/chat': () => import('@/routes/chat/ChatPage'),
  '/extension': () => import('@/routes/extensions/ExtensionPage'),
  '/knowledge-base': () => import('@/routes/knowledge/KnowledgeBaseListPage'),
  '/providers': () => import('@/routes/configuration/ProviderPage'),
  '/session-management': () => import('@/routes/monitoring/SessionManagementPage'),
} as const;

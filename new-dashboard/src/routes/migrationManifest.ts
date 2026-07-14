export type RouteRuntime = 'legacy' | 'react';

export type RouteMigrationEntry = {
  path: string;
  runtime: RouteRuntime;
};

export const routeMigrationManifest: readonly RouteMigrationEntry[] = [
  { path: '/', runtime: 'legacy' },
  { path: '/main', runtime: 'legacy' },
  { path: '/auth/login', runtime: 'react' },
  { path: '/auth/setup', runtime: 'react' },
  { path: '/welcome', runtime: 'react' },
  { path: '/about', runtime: 'react' },
  { path: '/dashboard/default', runtime: 'react' },
  { path: '/console', runtime: 'react' },
  { path: '/trace', runtime: 'react' },
  { path: '/conversation', runtime: 'react' },
  { path: '/session-management', runtime: 'react' },
  { path: '/platforms', runtime: 'legacy' },
  { path: '/providers', runtime: 'legacy' },
  { path: '/config', runtime: 'legacy' },
  { path: '/normal', runtime: 'legacy' },
  { path: '/system', runtime: 'legacy' },
  { path: '/settings', runtime: 'legacy' },
  { path: '/persona', runtime: 'legacy' },
  { path: '/subagent', runtime: 'legacy' },
  { path: '/cron', runtime: 'legacy' },
  { path: '/extension', runtime: 'legacy' },
  { path: '/extension/:pluginId', runtime: 'legacy' },
  { path: '/extension-marketplace', runtime: 'legacy' },
  { path: '/plugin-page/:pluginName/:pageName', runtime: 'legacy' },
  { path: '/knowledge-base', runtime: 'legacy' },
  { path: '/knowledge-base/:kbId', runtime: 'legacy' },
  { path: '/knowledge-base/:kbId/document/:docId', runtime: 'legacy' },
  { path: '/alkaid/knowledge-base', runtime: 'legacy' },
  { path: '/chat', runtime: 'legacy' },
  { path: '/chat/:conversationId', runtime: 'legacy' },
  { path: '/chatbox', runtime: 'legacy' },
  { path: '/chatbox/:conversationId', runtime: 'legacy' },
] as const;

export const migratedRoutePaths = routeMigrationManifest
  .filter((route) => route.runtime === 'react')
  .map((route) => route.path);

const publicRoutePaths = new Set(['/auth/login', '/auth/setup']);

export function routeRequiresAuth(path: string) {
  return !publicRoutePaths.has(path);
}

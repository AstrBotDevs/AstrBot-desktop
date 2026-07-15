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
  { path: '/platforms', runtime: 'react' },
  { path: '/providers', runtime: 'react' },
  { path: '/config', runtime: 'react' },
  { path: '/normal', runtime: 'react' },
  { path: '/system', runtime: 'react' },
  { path: '/settings', runtime: 'react' },
  { path: '/persona', runtime: 'react' },
  { path: '/subagent', runtime: 'react' },
  { path: '/cron', runtime: 'react' },
  { path: '/extension', runtime: 'react' },
  { path: '/extension/:pluginId', runtime: 'react' },
  { path: '/extension-marketplace', runtime: 'react' },
  { path: '/plugin-page/:pluginName/:pageName', runtime: 'react' },
  { path: '/knowledge-base', runtime: 'react' },
  { path: '/knowledge-base/:kbId', runtime: 'react' },
  { path: '/knowledge-base/:kbId/document/:docId', runtime: 'react' },
  { path: '/alkaid/knowledge-base', runtime: 'react' },
  { path: '/chat', runtime: 'react' },
  { path: '/chat/:conversationId', runtime: 'react' },
  { path: '/chatbox', runtime: 'react' },
  { path: '/chatbox/:conversationId', runtime: 'react' },
] as const;

export const migratedRoutePaths = routeMigrationManifest
  .filter((route) => route.runtime === 'react')
  .map((route) => route.path);

const publicRoutePaths = new Set(['/auth/login', '/auth/setup']);

export function routeRequiresAuth(path: string) {
  return !publicRoutePaths.has(path);
}

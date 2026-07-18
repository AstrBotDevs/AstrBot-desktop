export type RouteManifestEntry = {
  path: string;
};

export type RouteLayout = 'protected-full' | 'protected-blank' | 'public-blank';

export const routeManifest: readonly RouteManifestEntry[] = [
  { path: '/' },
  { path: '/main' },
  { path: '/auth/login' },
  { path: '/auth/setup' },
  { path: '/welcome' },
  { path: '/about' },
  { path: '/dashboard/default' },
  { path: '/console' },
  { path: '/trace' },
  { path: '/conversation' },
  { path: '/session-management' },
  { path: '/platforms' },
  { path: '/providers' },
  { path: '/config' },
  { path: '/normal' },
  { path: '/system' },
  { path: '/settings' },
  { path: '/persona' },
  { path: '/subagent' },
  { path: '/cron' },
  { path: '/extension' },
  { path: '/extension/:pluginId' },
  { path: '/extension-marketplace' },
  { path: '/plugin-page/:pluginName/:pageName' },
  { path: '/knowledge-base' },
  { path: '/knowledge-base/:kbId' },
  { path: '/knowledge-base/:kbId/document/:docId' },
  { path: '/alkaid/knowledge-base' },
  { path: '/chat' },
  { path: '/chat/:conversationId' },
  { path: '/chatbox' },
  { path: '/chatbox/:conversationId' },
] as const;

export const routePaths = routeManifest.map((route) => route.path);

const publicRoutePaths = new Set(['/auth/login', '/auth/setup']);
const protectedBlankRoutePaths = new Set(['/chatbox', '/chatbox/:conversationId']);

export function routeLayout(path: string): RouteLayout {
  if (publicRoutePaths.has(path)) return 'public-blank';
  if (protectedBlankRoutePaths.has(path)) return 'protected-blank';
  return 'protected-full';
}

export function routeRequiresAuth(path: string) {
  return routeLayout(path) !== 'public-blank';
}

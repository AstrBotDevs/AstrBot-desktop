import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';

import { routeLayout, routeManifest, routePaths, routeRequiresAuth } from './routeManifest';

describe('route manifest contract', () => {
  it('contains each route only once', () => {
    const paths = routeManifest.map((route) => route.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('tracks every completed route batch', () => {
    expect(routeManifest.length).toBeGreaterThan(0);
    expect(routePaths).toEqual([
      '/',
      '/main',
      '/auth/login',
      '/auth/setup',
      '/welcome',
      '/about',
      '/dashboard/default',
      '/console',
      '/trace',
      '/conversation',
      '/session-management',
      '/platforms',
      '/providers',
      '/config',
      '/normal',
      '/system',
      '/settings',
      '/persona',
      '/subagent',
      '/cron',
      '/extension',
      '/extension/:pluginId',
      '/extension-marketplace',
      '/plugin-page/:pluginName/:pageName',
      '/knowledge-base',
      '/knowledge-base/:kbId',
      '/knowledge-base/:kbId/document/:docId',
      '/alkaid/knowledge-base',
      '/chat',
      '/chat/:conversationId',
      '/chatbox',
      '/chatbox/:conversationId',
    ]);
  });

  it('tracks the routes required for the first migration batches', () => {
    const paths = new Set(routeManifest.map((route) => route.path));

    const requiredPaths = [
      '/auth/login',
      '/welcome',
      '/extension/:pluginId',
      '/knowledge-base/:kbId/document/:docId',
      '/chat/:conversationId',
    ];
    expect(requiredPaths.every((path) => paths.has(path))).toBe(true);
  });

  it('keeps only authentication entry routes public', () => {
    expect(routeRequiresAuth('/auth/login')).toBe(false);
    expect(routeRequiresAuth('/auth/setup')).toBe(false);
    expect(routeRequiresAuth('/dashboard/default')).toBe(true);
    expect(routeRequiresAuth('/missing')).toBe(true);
  });

  it('assigns shared layouts without exposing chatbox routes', () => {
    expect(routeLayout('/auth/login')).toBe('public-blank');
    expect(routeRequiresAuth('/chatbox/session-2')).toBe(true);
    expect(routeLayout('/chatbox/:conversationId')).toBe('protected-blank');
    expect(routeLayout('/settings')).toBe('protected-full');
  });

  it('contains only React route metadata after migration completion', () => {
    expect(routeManifest.every((route) => Object.keys(route).length === 1)).toBe(true);
  });

  it.each([
    ['/extension/demo-plugin', '/extension/:pluginId', { pluginId: 'demo-plugin' }],
    [
      '/plugin-page/demo-plugin/settings',
      '/plugin-page/:pluginName/:pageName',
      { pluginName: 'demo-plugin', pageName: 'settings' },
    ],
    ['/knowledge-base/kb-1/document/doc-2', '/knowledge-base/:kbId/document/:docId', { kbId: 'kb-1', docId: 'doc-2' }],
    ['/chat/session-1', '/chat/:conversationId', { conversationId: 'session-1' }],
    ['/chatbox/session-2', '/chatbox/:conversationId', { conversationId: 'session-2' }],
  ])('preserves dynamic parameters for %s', (url, pattern, params) => {
    const matches = matchRoutes(
      routeManifest.map((route) => ({ path: route.path })),
      url,
    );
    expect(matches?.at(-1)?.route.path).toBe(pattern);
    expect(matches?.at(-1)?.params).toEqual(params);
  });
});

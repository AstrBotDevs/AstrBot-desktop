import { describe, expect, it } from 'vitest';

import {
  migratedRoutePaths,
  routeMigrationManifest,
  routeRequiresAuth,
} from './migrationManifest';

describe('route migration manifest', () => {
  it('contains each legacy route only once', () => {
    const paths = routeMigrationManifest.map((route) => route.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('tracks the completed authentication and static route batch', () => {
    expect(routeMigrationManifest.length).toBeGreaterThan(0);
    expect(migratedRoutePaths).toEqual([
      '/auth/login',
      '/auth/setup',
      '/welcome',
      '/about',
      '/dashboard/default',
      '/console',
      '/trace',
      '/conversation',
      '/session-management',
    ]);
  });

  it('tracks the routes required for the first migration batches', () => {
    const paths = new Set(routeMigrationManifest.map((route) => route.path));

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
  });
});

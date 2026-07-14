import { describe, expect, it } from 'vitest';

import { migratedRoutePaths, routeMigrationManifest } from './migrationManifest';

describe('route migration manifest', () => {
  it('contains each legacy route only once', () => {
    const paths = routeMigrationManifest.map((route) => route.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('starts with every route on the legacy runtime', () => {
    expect(routeMigrationManifest.length).toBeGreaterThan(0);
    expect(routeMigrationManifest.every((route) => route.runtime === 'legacy')).toBe(true);
    expect(migratedRoutePaths).toEqual([]);
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
});

import { beforeEach, describe, expect, it } from 'vitest';

import { useMigrationRuntimeStore } from './migrationRuntime';

const initialState = useMigrationRuntimeStore.getState();

describe('migration runtime store', () => {
  beforeEach(() => {
    useMigrationRuntimeStore.setState(initialState, true);
  });

  it('tracks a successful legacy handoff', () => {
    useMigrationRuntimeStore.getState().startLegacyLoad('#/welcome');
    expect(useMigrationRuntimeStore.getState()).toMatchObject({
      error: null,
      legacyRoute: '#/welcome',
      status: 'loading-legacy',
    });

    useMigrationRuntimeStore.getState().setLegacyReady();
    expect(useMigrationRuntimeStore.getState().status).toBe('legacy-ready');
  });

  it('retains a useful legacy loading error', () => {
    useMigrationRuntimeStore.getState().setLegacyError('HTTP 500');

    expect(useMigrationRuntimeStore.getState()).toMatchObject({
      error: 'HTTP 500',
      status: 'legacy-error',
    });
  });
});

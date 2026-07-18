import { beforeEach, describe, expect, it } from 'vitest';

import { useFeedbackStore } from '@/stores/feedback';
import { confirmDestructiveAction, confirmWarningAction } from './confirm';

describe('confirmation helpers', () => {
  beforeEach(() => {
    useFeedbackStore.setState({ confirmQueue: [] });
  });

  it.each([
    ['destructive', confirmDestructiveAction],
    ['warning', confirmWarningAction],
  ] as const)('queues %s confirmations with a consistent intent', (intent, confirm) => {
    void confirm('Continue?');
    expect(useFeedbackStore.getState().confirmQueue[0]).toMatchObject({
      intent,
      message: 'Continue?',
    });
  });
});

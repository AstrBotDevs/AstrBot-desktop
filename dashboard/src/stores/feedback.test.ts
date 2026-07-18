import { beforeEach, describe, expect, it } from 'vitest';

import { confirmAction, loading, normalizeConfirmOptions, toast, useFeedbackStore } from './feedback';

const initialState = useFeedbackStore.getState();

describe('global feedback state', () => {
  beforeEach(() => {
    useFeedbackStore.setState(
      {
        ...initialState,
        confirmQueue: [],
        loadingIds: new Set(),
        loadingProgress: null,
        toasts: [],
      },
      true,
    );
  });

  it('queues and dismisses typed toast messages', () => {
    const id = toast.success('Saved');
    expect(useFeedbackStore.getState().toasts[0]).toMatchObject({
      id,
      message: 'Saved',
      variant: 'success',
    });
    useFeedbackStore.getState().dismissToast(id);
    expect(useFeedbackStore.getState().toasts).toEqual([]);
  });

  it('resolves confirmation requests in queue order', async () => {
    const first = confirmAction('Delete item?');
    const second = confirmAction({ message: 'Restart?', title: 'Confirm restart' });
    const [firstRequest, secondRequest] = useFeedbackStore.getState().confirmQueue;

    useFeedbackStore.getState().resolveConfirmation(firstRequest.id, true);
    useFeedbackStore.getState().resolveConfirmation(secondRequest.id, false);

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
  });

  it('normalizes confirmation intent and keeps legacy destructive requests compatible', () => {
    expect(normalizeConfirmOptions({ danger: true, message: 'Delete?' })).toMatchObject({
      intent: 'destructive',
      message: 'Delete?',
    });
    expect(normalizeConfirmOptions({ intent: 'warning', message: 'Discard?' })).toMatchObject({
      intent: 'warning',
      message: 'Discard?',
    });
  });

  it('tracks concurrent loading operations and clamps progress', () => {
    const first = loading.start('first');
    const second = loading.start('second');
    loading.setProgress(140);
    expect(useFeedbackStore.getState().loadingIds.size).toBe(2);
    expect(useFeedbackStore.getState().loadingProgress).toBe(100);

    loading.finish(first);
    expect(useFeedbackStore.getState().loadingIds.size).toBe(1);
    loading.finish(second);
    expect(useFeedbackStore.getState()).toMatchObject({ loadingProgress: null });
  });
});

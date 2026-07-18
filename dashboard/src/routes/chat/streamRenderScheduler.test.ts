import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStreamRenderScheduler } from './streamRenderScheduler';

function frameHarness() {
  let nextHandle = 1;
  const frames = new Map<number, FrameRequestCallback>();
  return {
    cancelFrame: vi.fn((handle: number) => {
      frames.delete(handle);
    }),
    requestFrame: vi.fn((callback: FrameRequestCallback) => {
      const handle = nextHandle++;
      frames.set(handle, callback);
      return handle;
    }),
    runFrame(time: number) {
      const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
      if (!entry) throw new Error('No animation frame is queued.');
      frames.delete(entry[0]);
      entry[1](time);
    },
  };
}

describe('stream render scheduler', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces multiple chunks into one animation frame', () => {
    const frames = frameHarness();
    const render = vi.fn();
    const scheduler = createStreamRenderScheduler(render, {
      cancelFrame: frames.cancelFrame,
      now: () => 0,
      requestFrame: frames.requestFrame,
    });

    scheduler.schedule();
    scheduler.schedule();
    scheduler.schedule();

    expect(frames.requestFrame).toHaveBeenCalledTimes(1);
    frames.runFrame(0);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('limits updates while allowing the final content to flush immediately', () => {
    vi.useFakeTimers();
    let now = 0;
    const frames = frameHarness();
    const render = vi.fn();
    const scheduler = createStreamRenderScheduler(render, {
      cancelFrame: frames.cancelFrame,
      intervalMs: 32,
      now: () => now,
      requestFrame: frames.requestFrame,
    });

    scheduler.schedule();
    frames.runFrame(now);
    now = 8;
    scheduler.schedule();
    expect(frames.requestFrame).toHaveBeenCalledTimes(1);

    now = 32;
    vi.advanceTimersByTime(24);
    expect(frames.requestFrame).toHaveBeenCalledTimes(2);
    frames.runFrame(now);
    expect(render).toHaveBeenCalledTimes(2);

    now = 40;
    scheduler.schedule();
    scheduler.flush();
    expect(render).toHaveBeenCalledTimes(3);
    vi.runAllTimers();
    expect(frames.requestFrame).toHaveBeenCalledTimes(2);
  });

  it('cancels a queued render', () => {
    const frames = frameHarness();
    const render = vi.fn();
    const scheduler = createStreamRenderScheduler(render, {
      cancelFrame: frames.cancelFrame,
      now: () => 0,
      requestFrame: frames.requestFrame,
    });

    scheduler.schedule();
    scheduler.cancel();

    expect(frames.cancelFrame).toHaveBeenCalledTimes(1);
    expect(render).not.toHaveBeenCalled();
  });
});

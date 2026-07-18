const DEFAULT_STREAM_RENDER_INTERVAL_MS = 32;

type StreamRenderSchedulerOptions = {
  cancelFrame?: (handle: number) => void;
  intervalMs?: number;
  now?: () => number;
  requestFrame?: (callback: FrameRequestCallback) => number;
};

export function createStreamRenderScheduler(render: () => void, options: StreamRenderSchedulerOptions = {}) {
  const intervalMs = Math.max(0, options.intervalMs ?? DEFAULT_STREAM_RENDER_INTERVAL_MS);
  const now = options.now ?? (() => performance.now());
  const requestFrame = options.requestFrame ?? ((callback) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle) => cancelAnimationFrame(handle));
  let dirty = false;
  let frame: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRenderAt = Number.NEGATIVE_INFINITY;

  const commit = () => {
    if (!dirty) return;
    dirty = false;
    lastRenderAt = now();
    render();
  };

  const queueFrame = () => {
    timer = null;
    if (frame !== null) return;
    frame = requestFrame(() => {
      frame = null;
      commit();
    });
  };

  const clearScheduledWork = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (frame !== null) {
      cancelFrame(frame);
      frame = null;
    }
  };

  return {
    cancel() {
      clearScheduledWork();
      dirty = false;
    },
    flush() {
      clearScheduledWork();
      commit();
    },
    schedule() {
      dirty = true;
      if (timer !== null || frame !== null) return;
      const delay = Math.max(0, intervalMs - (now() - lastRenderAt));
      if (delay > 0) timer = setTimeout(queueFrame, delay);
      else queueFrame();
    },
  };
}

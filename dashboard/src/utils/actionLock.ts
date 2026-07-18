export type ActionLock = { current: boolean };

/**
 * Synchronously acquires a lock before React has time to commit a disabled
 * state. The returned release callback is idempotent.
 */
export function acquireActionLock(lock: ActionLock) {
  if (lock.current) return null;
  lock.current = true;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    lock.current = false;
  };
}

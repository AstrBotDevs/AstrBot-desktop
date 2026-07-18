import { useCallback, useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

import { confirmWarningAction, type IntentConfirmOptions } from './confirm';

export function useUnsavedChangesGuard(when: boolean, options: IntentConfirmOptions | string) {
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const blocker = useBlocker(when);

  const confirmDiscard = useCallback(
    () => (when ? confirmWarningAction(optionsRef.current) : Promise.resolve(true)),
    [when],
  );

  useEffect(() => {
    if (!when) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [when]);

  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    let active = true;
    void confirmWarningAction(optionsRef.current).then((confirmed) => {
      if (!active || blocker.state !== 'blocked') return;
      if (confirmed) blocker.proceed();
      else blocker.reset();
    });
    return () => {
      active = false;
    };
  }, [blocker]);

  return confirmDiscard;
}

import { useCallback, useEffect, useRef, useState } from 'react';

import { useBrowserCapabilities } from './BrowserCapabilitiesProvider';

export function subscribeEvent(
  target: EventTarget,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions | boolean,
) {
  target.addEventListener(type, listener, options);
  return () => target.removeEventListener(type, listener, options);
}

export function useEventListener(
  target: EventTarget | null | undefined,
  type: string,
  listener: EventListener,
  options?: AddEventListenerOptions | boolean,
) {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;
  useEffect(() => {
    if (!target) return;
    const handler: EventListener = (event) => listenerRef.current(event);
    return subscribeEvent(target, type, handler, options);
  }, [options, target, type]);
}

export function useObjectUrlRegistry() {
  const { createObjectUrl, revokeObjectUrl } = useBrowserCapabilities();
  const urls = useRef(new Set<string>());
  const mounted = useRef(true);
  const create = useCallback(
    (blob: Blob) => {
      const url = createObjectUrl(blob);
      if (!mounted.current) {
        revokeObjectUrl(url);
        return '';
      }
      urls.current.add(url);
      return url;
    },
    [createObjectUrl, revokeObjectUrl],
  );
  const revoke = useCallback(
    (url?: string | null) => {
      if (!url || !urls.current.delete(url)) return;
      revokeObjectUrl(url);
    },
    [revokeObjectUrl],
  );
  const clear = useCallback(() => {
    urls.current.forEach(revokeObjectUrl);
    urls.current.clear();
  }, [revokeObjectUrl]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clear();
    };
  }, [clear]);
  return { clear, create, revoke };
}

export function useFullscreen(target: React.RefObject<Element | null>) {
  const { fullscreen } = useBrowserCapabilities();
  const [active, setActive] = useState(false);
  const documentTarget = typeof document === 'undefined' ? null : document;
  const sync = useCallback(
    () => setActive(Boolean(target.current && fullscreen.activeElement() === target.current)),
    [fullscreen, target],
  );
  useEventListener(documentTarget, 'fullscreenchange', sync as EventListener);
  const toggle = useCallback(async () => {
    const element = target.current;
    if (!element) return false;
    const next = await fullscreen.toggle(element);
    setActive(next);
    return next;
  }, [fullscreen, target]);
  return { active, toggle };
}

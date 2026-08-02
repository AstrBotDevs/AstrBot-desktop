import { useEffect } from 'react';

const SCROLLBAR_HIDE_DELAY = 700;
const ACTIVE_ATTRIBUTE = 'data-scrollbar-active';
const ROOT_CLASS = 'auto-hide-scrollbars';

function scrollTarget(eventTarget: EventTarget | null) {
  if (eventTarget instanceof Element) return eventTarget;
  if (eventTarget === document) return document.documentElement;
  return null;
}

export function AutoHideScrollbars() {
  useEffect(() => {
    const timers = new Map<Element, number>();
    const root = document.documentElement;

    const handleScroll = (event: Event) => {
      const target = scrollTarget(event.target);
      if (!target) return;

      target.setAttribute(ACTIVE_ATTRIBUTE, 'true');
      const existingTimer = timers.get(target);
      if (existingTimer != null) window.clearTimeout(existingTimer);

      const timer = window.setTimeout(() => {
        target.removeAttribute(ACTIVE_ATTRIBUTE);
        timers.delete(target);
      }, SCROLLBAR_HIDE_DELAY);
      timers.set(target, timer);
    };

    root.classList.add(ROOT_CLASS);
    document.addEventListener('scroll', handleScroll, true);

    return () => {
      document.removeEventListener('scroll', handleScroll, true);
      root.classList.remove(ROOT_CLASS);
      for (const [target, timer] of timers) {
        window.clearTimeout(timer);
        target.removeAttribute(ACTIVE_ATTRIBUTE);
      }
    };
  }, []);

  return null;
}

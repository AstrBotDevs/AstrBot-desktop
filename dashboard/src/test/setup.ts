import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => cleanup());

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      addEventListener: () => undefined,
      addListener: () => undefined,
      dispatchEvent: () => false,
      matches: false,
      media: query,
      onchange: null,
      removeEventListener: () => undefined,
      removeListener: () => undefined,
    }),
  });
  Element.prototype.scrollIntoView ??= () => undefined;
  window.requestAnimationFrame ??= (callback) => window.setTimeout(() => callback(performance.now()), 0);
  window.cancelAnimationFrame ??= (handle) => window.clearTimeout(handle);
}

/**
 * UI test setup — runs before all *.ui.test.* files (jsdom project).
 * Trimmed from minusx test/setup/vitest.setup.ui.ts: the polyfills the ported
 * engine/kit tests need; app-only mocks (Monaco, Chakra, navigation) arrive
 * with the editor port if their tests need them.
 */
import '@testing-library/jest-dom';
import { vi, beforeAll, afterAll, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// structuredClone polyfill — jsdom doesn't expose Node's global to the window scope.
if (typeof structuredClone === 'undefined') {
  const v8 = require('v8') as typeof import('v8');
  (global as any).structuredClone = (val: unknown) => v8.deserialize(v8.serialize(val));
}

// ResizeObserver polyfill (radix + react-grid-layout use it)
global.ResizeObserver = vi.fn().mockImplementation(function (this: any) {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
});

// HTMLCanvasElement.getContext stub
HTMLCanvasElement.prototype.getContext = vi.fn(() => null) as any;

// Next.js navigation (AgentHtml's link bridge grabs a router)

/**
 * Drain deferred unmounts BEFORE vitest tears the jsdom environment down.
 *
 * AgentHtml mounts a second React root for the in-iframe embeds and unmounts it
 * from a `setTimeout(…, 0)` — deliberately, because unmounting another root
 * synchronously during the parent's commit makes React warn. Nothing in the app
 * is wrong with that. But at the end of a test FILE the sequence becomes:
 * RTL cleanup unmounts the parent → the deferred unmount is queued → vitest
 * disposes the jsdom window → the timer finally fires and React reaches for
 * `window`, which no longer exists:
 *
 *   ReferenceError: window is not defined
 *     ❯ react-dom-client.development.js
 *     ❯ Immediate.performWorkUntilDeadline (scheduler)
 *
 * Every test still PASSES; vitest counts the unhandled error and exits 1, so it
 * reads as "main is broken" while the summary says 254 passed. It is timing
 * dependent — it shows up on CI runners and not on a fast laptop.
 *
 * Unmounting explicitly and then yielding one macrotask lets that timer land
 * while the window is still alive. `cleanup()` is idempotent, so calling it
 * here as well as through RTL's own hook is harmless.
 */
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 0));
});

// Mute known jsdom noise
const originalError = console.error.bind(console);
const preventJsdomNavigation = (event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target.closest('a[href]') : null;
  if (target) event.preventDefault();
};
beforeAll(() => {
  // React handlers run at their root before this document-level listener, so
  // link behavior is still exercised; only jsdom's unsupported default
  // full-document navigation is cancelled afterward.
  document.addEventListener('click', preventJsdomNavigation);
  console.error = (...args: any[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : '';
    if (msg.includes('Warning: ReactDOM.render') || msg.includes('act(') || msg.includes('Not implemented: navigation')) return;
    originalError(...args);
  };
});
afterAll(() => {
  document.removeEventListener('click', preventJsdomNavigation);
  console.error = originalError;
});

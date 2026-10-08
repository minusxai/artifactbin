/**
 * `islands` shares one module graph and one jsdom per worker (vitest.config.ts), so what a file leaves
 * in the window outlives it. @solidjs/testing-library registers its automatic cleanup once, when the
 * shared graph first imports it (as does solid/__tests__/helpers), so this re-registers both for every file and, after each file, returns
 * the window to how a fresh jsdom starts: no mounted roots, an empty document, clear storage, the
 * root URL, real timers and unstubbed globals.
 */
import { installEditorGeometry } from './editor-geometry';
import { beforeAll, afterAll, afterEach, vi } from 'vitest';
import { cleanupSharedJsdom } from './shared-jsdom-lifecycle';

const clearAttributes = (element: Element) => { for (const { name } of [...element.attributes]) element.removeAttribute(name); };

afterEach(cleanupSharedJsdom);
afterAll(async () => {
  await cleanupSharedJsdom();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.replaceChildren();
  document.body.replaceChildren();
  clearAttributes(document.documentElement);
  clearAttributes(document.body);
  try { localStorage.clear(); sessionStorage.clear(); } catch { /* storage unavailable */ }
  window.history.replaceState(null, '', '/');
});

let restoreEditorGeometry: () => void;
beforeAll(() => { restoreEditorGeometry = installEditorGeometry(); });
afterAll(() => restoreEditorGeometry());

/** Start an optional widget only after island hydration has signalled reader readiness.
 * A visible widget starts on the next task; an offscreen widget starts at idle so
 * exports and full-page captures still reach the same settled DOM.
 */
import { ISLANDS_READY_EVENT } from './contract';
import { READER_READY_ATTR } from '@/lib/story-runtime/contract';

export function deferEngine(host: Element, start: () => void): () => void {
  const doc = host.ownerDocument;
  const win = doc.defaultView;
  let stopped = false;
  let started = false;
  let observer: IntersectionObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let idle: number | null = null;
  const run = () => {
    if (stopped || started) return;
    started = true;
    observer?.disconnect();
    observer = null;
    if (idle !== null) win?.cancelIdleCallback?.(idle);
    idle = null;
    if (timer !== null) clearTimeout(timer);
    // A ready listener can run during dispatch: leave that task before fetching the engine.
    timer = setTimeout(() => { timer = null; if (!stopped) start(); }, 0);
  };
  const afterReady = () => {
    if (stopped) return;
    if (win && 'IntersectionObserver' in win) {
      observer = new win.IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) run();
      });
      observer.observe(host);
      if ('requestIdleCallback' in win) idle = win.requestIdleCallback(run, { timeout: 1500 });
      else timer = setTimeout(run, 1500);
    } else run();
  };
  if (doc.documentElement.hasAttribute(READER_READY_ATTR)) afterReady();
  else doc.addEventListener(ISLANDS_READY_EVENT, afterReady, { once: true });
  return () => {
    stopped = true;
    doc.removeEventListener(ISLANDS_READY_EVENT, afterReady);
    observer?.disconnect();
    if (idle !== null) win?.cancelIdleCallback?.(idle);
    if (timer !== null) clearTimeout(timer);
  };
}

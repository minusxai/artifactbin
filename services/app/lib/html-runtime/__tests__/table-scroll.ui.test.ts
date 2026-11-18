/**
 * The scroll AFFORDANCE on a table wider than its column — the one part CSS
 * cannot decide alone, because "can this scroll" is a layout fact. Every
 * served document loads this from its ~1 KB entry (a prose document has
 * tables too and ships no runtime), marks each overflowing table, and keeps
 * the mark honest as the reader scrolls it and as the viewport changes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { markScrollableTables } from '@/lib/html-runtime/table-scroll-model';

function table(scrollWidth: number, clientWidth: number): HTMLTableElement {
  const t = doc.createElement('table');
  Object.defineProperty(t, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(t, 'clientWidth', { value: clientWidth, configurable: true });
  doc.body.appendChild(t);
  return t;
}
/**
 * Each case wires a document of its own (an iframe's): the shared islands jsdom keeps lib/islands/page's module-level
 * wiring on the top document, and that listener would answer this file's events too.
 */
let doc: Document;
beforeEach(() => { const frame = document.createElement('iframe'); document.body.appendChild(frame); doc = frame.contentDocument!; });
/** Every watcher is disposed between cases — a leaked one marks the next test's tables. */
let stop: (() => void) | null = null;
const watch = () => { stop = markScrollableTables(doc); return stop; };
afterEach(() => { stop?.(); stop = null; document.body.innerHTML = ''; });

/**
 * A MutationObserver hears of a new table in a microtask and sweeps 16 ms later (a debounce on the page's timer):
 * one event-loop turn delivers the mutation, then the faked clock passes the debounce.
 */
const mutationsDelivered = async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try { await new Promise((resolve) => setImmediate(resolve)); vi.advanceTimersByTime(16); }
  finally { vi.useRealTimers(); }
};

describe('markScrollableTables', () => {
  it('marks a table that overflows its column, and leaves one that fits alone', () => {
    const wide = table(900, 340);
    const fits = table(300, 340);
    watch();
    expect(wide.getAttribute('data-mx-scrollable')).toBe('');
    expect(fits.hasAttribute('data-mx-scrollable')).toBe(false);
  });

  it('says "end" once the reader has scrolled to the last column, and back again', () => {
    const wide = table(900, 340);
    watch();
    wide.scrollLeft = 560;
    wide.dispatchEvent(new Event('scroll'));
    expect(wide.getAttribute('data-mx-scrollable')).toBe('end');
    wide.scrollLeft = 0;
    wide.dispatchEvent(new Event('scroll'));
    expect(wide.getAttribute('data-mx-scrollable')).toBe('');
  });

  it('picks up a table that ARRIVES LATER — an agent write, a query re-run, a DataTable that just mounted', async () => {
    watch();
    const late = table(900, 340);
    await mutationsDelivered();
    expect(late.getAttribute('data-mx-scrollable')).toBe('');
    // …and it is a live scroll box, not just marked once.
    late.scrollLeft = 560;
    late.dispatchEvent(new Event('scroll'));
    expect(late.getAttribute('data-mx-scrollable')).toBe('end');
  });

  it('stops watching once disposed', async () => {
    watch();
    stop!();
    stop = null;
    const late = table(900, 340);
    await mutationsDelivered();
    expect(late.hasAttribute('data-mx-scrollable')).toBe(false);
  });

  it('re-measures on resize — a rotated phone changes the answer', () => {
    const t = table(900, 340);
    watch();
    expect(t.hasAttribute('data-mx-scrollable')).toBe(true);
    Object.defineProperty(t, 'clientWidth', { value: 1000, configurable: true });
    doc.defaultView!.dispatchEvent(new Event('resize'));
    expect(t.hasAttribute('data-mx-scrollable')).toBe(false);
  });
});

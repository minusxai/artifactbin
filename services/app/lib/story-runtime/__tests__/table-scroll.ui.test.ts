/**
 * The scroll AFFORDANCE on a table wider than its column — the one part CSS
 * cannot decide alone, because "can this scroll" is a layout fact. Every
 * served document loads this from its ~1 KB entry (a prose document has
 * tables too and ships no runtime), marks each overflowing table, and keeps
 * the mark honest as the reader scrolls it and as the viewport changes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { markScrollableTables } from '@/lib/story-runtime/table-scroll';

function table(scrollWidth: number, clientWidth: number): HTMLTableElement {
  const t = document.createElement('table');
  Object.defineProperty(t, 'scrollWidth', { value: scrollWidth, configurable: true });
  Object.defineProperty(t, 'clientWidth', { value: clientWidth, configurable: true });
  document.body.appendChild(t);
  return t;
}
/** Every watcher is disposed between cases — a leaked one marks the next test's tables. */
let stop: (() => void) | null = null;
const watch = () => { stop = markScrollableTables(document); return stop; };
afterEach(() => { stop?.(); stop = null; document.body.innerHTML = ''; });

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
    await new Promise((r) => setTimeout(r, 40));
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
    await new Promise((r) => setTimeout(r, 40));
    expect(late.hasAttribute('data-mx-scrollable')).toBe(false);
  });

  it('re-measures on resize — a rotated phone changes the answer', () => {
    const t = table(900, 340);
    watch();
    expect(t.hasAttribute('data-mx-scrollable')).toBe(true);
    Object.defineProperty(t, 'clientWidth', { value: 1000, configurable: true });
    window.dispatchEvent(new Event('resize'));
    expect(t.hasAttribute('data-mx-scrollable')).toBe(false);
  });
});

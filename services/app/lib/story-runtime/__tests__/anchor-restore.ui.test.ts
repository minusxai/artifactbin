/**
 * THE RESTORE LOOP MUST YIELD TO THE READER.
 *
 * A document with no runtime reloads to show a live update, and its reading
 * position is carried across (lib/story/scroll-anchor). Restoring it once is
 * not enough — fonts, images and embeds all land after the parse and each one
 * moves everything below it — so the position is re-applied for a few seconds.
 *
 * The cost, found by the outline gate: for those seconds the document fights
 * the reader. Clicking a table-of-contents row scrolled the page and the loop
 * pulled it straight back, deterministically, with nothing on screen to say
 * why. Anything the reader does to move the page therefore ENDS the restore —
 * it has served its purpose the moment they take over.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { holdAnchor } from '@/lib/story-runtime/anchor-restore';

let stop: (() => void) | null = null;
afterEach(() => { stop?.(); stop = null; vi.useRealTimers(); });

const anchor = { path: '0.1', fraction: 0 };

describe('holdAnchor', () => {
  it('re-applies the position while the page is still settling', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    stop = holdAnchor(window, anchor, apply);
    expect(apply).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(350);
    expect(apply.mock.calls.length).toBeGreaterThan(2);
  });

  it('STOPS the moment the reader takes over — a wheel, a touch, a key, a click', () => {
    for (const event of [new Event('wheel'), new Event('touchstart'), new KeyboardEvent('keydown', { key: 'PageDown' }), new Event('mousedown')]) {
      vi.useFakeTimers();
      const apply = vi.fn();
      const off = holdAnchor(window, anchor, apply);
      const before = apply.mock.calls.length;
      window.dispatchEvent(event);
      vi.advanceTimersByTime(600);
      expect(apply.mock.calls.length, event.type).toBe(before);
      off();
      vi.useRealTimers();
    }
  });

  it('gives up on its own after the settle window', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    stop = holdAnchor(window, anchor, apply);
    vi.advanceTimersByTime(10_000);
    const settled = apply.mock.calls.length;
    vi.advanceTimersByTime(10_000);
    expect(apply.mock.calls.length).toBe(settled);
  });

  it('ignores a keypress that does not move the page (typing in a field is not taking over)', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    stop = holdAnchor(window, anchor, apply);
    const before = apply.mock.calls.length;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    vi.advanceTimersByTime(300);
    expect(apply.mock.calls.length).toBeGreaterThan(before);
  });

  it('disposes cleanly', () => {
    vi.useFakeTimers();
    const apply = vi.fn();
    const off = holdAnchor(window, anchor, apply);
    off();
    const after = apply.mock.calls.length;
    vi.advanceTimersByTime(1000);
    expect(apply.mock.calls.length).toBe(after);
  });
});

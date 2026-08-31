/**
 * Holding the reader's place across the reload a no-runtime document needs —
 * and LETTING GO the moment they take over.
 *
 * Restoring once is not enough: the document has only just parsed, and its
 * fonts, images and embeds each move everything below them as they land. So
 * the position is re-applied for a few seconds.
 *
 * Those seconds used to be seconds in which the document fought its reader.
 * The outline gate found it: clicking a table-of-contents row scrolled the
 * page and the loop pulled it straight back, every time, with nothing on
 * screen to explain why. The restore exists to spare the reader a jump they
 * did not ask for — so the instant they ask for one, it has done its job and
 * must stop. A wheel, a touch, a paging key or a mouse press ends it.
 *
 * Split out of anchor-entry so it can be tested without a document: what
 * matters here is the yielding, and that is pure timer and listener logic.
 */
import type { ScrollAnchor } from '@/lib/story/scroll-anchor';

/** How long the position is held against a settling layout. */
const SETTLE_MS = 4000;
const STEP_MS = 100;

/** Keys that move the page — the ones whose effect the loop would undo. */
const PAGING_KEYS = new Set([
  'PageDown', 'PageUp', 'Home', 'End', 'ArrowDown', 'ArrowUp', ' ', 'Spacebar',
]);

/** The events that mean "the reader is driving now". */
const TAKEOVER = ['wheel', 'touchstart', 'mousedown', 'keydown'] as const;

/**
 * Re-apply `anchor` while the page settles, and stop early when the reader
 * takes over. Returns a disposer.
 */
export function holdAnchor(
  win: Window,
  anchor: ScrollAnchor,
  apply: (win: Window, anchor: ScrollAnchor) => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = 0;
  let done = false;

  const stop = () => {
    if (done) return;
    done = true;
    if (timer) { clearTimeout(timer); timer = null; }
    for (const type of TAKEOVER) win.removeEventListener(type, onTakeover);
  };

  function onTakeover(event: Event) {
    // Typing is not taking over: a key that cannot move the page leaves the
    // restore alone (a reader may be in a field inside the document).
    if (event.type === 'keydown' && !PAGING_KEYS.has((event as KeyboardEvent).key)) return;
    stop();
  }

  const tick = () => {
    if (done) return;
    apply(win, anchor);
    if (++held * STEP_MS >= SETTLE_MS) { stop(); return; }
    timer = setTimeout(tick, STEP_MS);
  };

  for (const type of TAKEOVER) win.addEventListener(type, onTakeover, { passive: true });
  tick();
  return stop;
}

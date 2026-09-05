/**
 * WHEN THE READER CHROME IS ON SCREEN — a pure reducer, no DOM, so the rule
 * can be pinned by a unit test and the entry module only has to sample.
 *
 * The rule the product owner asked for, in full:
 *  - on load, NOTHING but the artifact — unless the document cannot scroll at
 *    all (then no gesture could ever reveal the chrome) or the reader has
 *    landed at its END (a restored position; the footer rule below applies);
 *  - a scroll UP reveals it, a scroll DOWN hides it;
 *  - the END of the document shows it: the reader has stopped looking for
 *    more page and started looking for the controls, and there is no further
 *    downward scroll left that could bring it back.
 *
 * The 4px slack absorbs subpixel rounding and the mobile URL bar, which
 * changes the viewport height under us as it collapses; the 4px dead zone on
 * direction is what keeps touch-scroll jitter from making the chrome flicker
 * (both numbers are the ones today's phone dock already uses).
 */

export interface ChromeSample {
  scrollY: number;
  viewportHeight: number;
  documentHeight: number;
}

export interface ChromeState {
  visible: boolean;
  /** The baseline the next direction is judged against; moves only past the dead zone. */
  lastScrollY: number;
}

export const CHROME_SLACK_PX = 4;
export const CHROME_DEAD_ZONE_PX = 4;

/**
 * The next state after a sample. `state === null` is the FIRST sample (load):
 * hidden on a scrollable document, shown on one that fits or is already at
 * its end.
 */
export function chromeAfterSample(state: ChromeState | null, sample: ChromeSample): ChromeState {
  const scrollY = sample.scrollY;
  const scrollable = sample.documentHeight > sample.viewportHeight + CHROME_SLACK_PX;
  const atEnd = scrollY + sample.viewportHeight >= sample.documentHeight - CHROME_SLACK_PX;

  // LOAD. Nothing but the artifact — unless there is no gesture that could
  // ever bring the chrome back (a document that fits) or the reader is already
  // where the downward gesture runs out (its end).
  if (state === null) return { visible: !scrollable || atEnd, lastScrollY: scrollY };

  const delta = scrollY - state.lastScrollY;
  // The baseline HOLDS through jitter, so a finger's noise cannot accumulate
  // into a direction one pixel at a time — only a real move past the dead zone
  // moves it.
  const lastScrollY = Math.abs(delta) >= CHROME_DEAD_ZONE_PX ? scrollY : state.lastScrollY;

  // Order matters: the two structural answers (nothing to scroll, nowhere left
  // to scroll) outrank the direction, which is why the end shows the chrome
  // even on the way down.
  const visible = !scrollable || atEnd
    ? true
    : delta <= -CHROME_DEAD_ZONE_PX
      ? true
      : delta >= CHROME_DEAD_ZONE_PX
        ? false
        : state.visible;

  return { visible, lastScrollY };
}

/**
 * THE VISIBILITY RULE, pinned: visible on load, up reveals, down hides, the
 * end and an unscrollable document show. Numbers are the ones the phone dock
 * already used (4px slack, 4px dead zone), so the two cannot drift.
 */
import { describe, expect, it } from 'vitest';
import { chromeAfterSample, type ChromeSample, type ChromeState } from '@/lib/story-runtime/reader-chrome-policy';
import { STORY_CHROME_CSS } from '../chrome-css';

const long = (scrollY: number): ChromeSample => ({ scrollY, viewportHeight: 800, documentHeight: 4000 });
const short = (scrollY = 0): ChromeSample => ({ scrollY, viewportHeight: 800, documentHeight: 600 });

describe('chromeAfterSample', () => {
  it('starts SHOWN on a document that scrolls', () => {
    expect(chromeAfterSample(null, long(0))).toEqual({ visible: true, lastScrollY: 0 });
  });

  it('starts SHOWN on a document that cannot scroll — no gesture could reveal it', () => {
    expect(chromeAfterSample(null, short())).toEqual({ visible: true, lastScrollY: 0 });
    // Exactly the slack: 804 tall in an 800 viewport is "does not scroll"; 805 is a document.
    expect(chromeAfterSample(null, { scrollY: 0, viewportHeight: 800, documentHeight: 804 }).visible).toBe(true);
    expect(chromeAfterSample(null, { scrollY: 0, viewportHeight: 800, documentHeight: 805 }).visible).toBe(true);
  });

  it('starts SHOWN when the reader lands at the end (a restored position)', () => {
    expect(chromeAfterSample(null, long(3200)).visible).toBe(true);
    // 3196 + 800 = 3996 = 4000 - 4: the last scrollable pixel, with the slack.
    expect(chromeAfterSample(null, long(3196)).visible).toBe(true);
    expect(chromeAfterSample(null, long(3195)).visible).toBe(true);
  });

  it('a scroll down keeps it hidden and a scroll up reveals it', () => {
    let state = chromeAfterSample(null, long(0));
    state = chromeAfterSample(state, long(600));
    expect(state).toEqual({ visible: false, lastScrollY: 600 });
    state = chromeAfterSample(state, long(596));
    expect(state).toEqual({ visible: true, lastScrollY: 596 });
    state = chromeAfterSample(state, long(700));
    expect(state).toEqual({ visible: false, lastScrollY: 700 });
  });

  it('ignores jitter under the dead zone in either direction and holds its baseline', () => {
    let state: ChromeState = { visible: true, lastScrollY: 600 };
    state = chromeAfterSample(state, long(603));
    expect(state).toEqual({ visible: true, lastScrollY: 600 });
    state = chromeAfterSample(state, long(597));
    expect(state).toEqual({ visible: true, lastScrollY: 600 });
    // Accumulated past the dead zone, it counts — against the held baseline.
    state = chromeAfterSample(state, long(604));
    expect(state).toEqual({ visible: false, lastScrollY: 604 });
  });

  it('shows at the end of the document even on the way down', () => {
    expect(chromeAfterSample({ visible: false, lastScrollY: 2000 }, long(3200))).toEqual({ visible: true, lastScrollY: 3200 });
  });

  it('shows when a resize makes the document fit its viewport', () => {
    const state = chromeAfterSample({ visible: false, lastScrollY: 100 }, { scrollY: 100, viewportHeight: 5000, documentHeight: 4000 });
    expect(state.visible).toBe(true);
  });

  it('never mutates the state it was given', () => {
    const before: ChromeState = { visible: false, lastScrollY: 600 };
    chromeAfterSample(before, long(500));
    expect(before).toEqual({ visible: false, lastScrollY: 600 });
  });
});

/**
 * Two invariants of the reader chrome's stylesheet, each learned by watching
 * the product: the bar may never hide with a TRANSFORM (a transformed
 * ancestor is the containing block for `position: fixed` descendants, and the
 * bar's own star is one — it sat at the bar's bottom-right, the top of the
 * screen, for the 200ms of every slide and then jumped to the viewport's), and
 * the document leaves the page's comment rail its width the same way it leaves
 * the pinned bars their height: through a variable the page sets.
 */
/** Every declaration block one of whose selectors targets the ROOT itself (a state class included) — never a descendant. */
const rootBlocks = (css: string, suffix: string): string[] =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => match[1].split(',').some((selector) => new RegExp(`(^|\\s)(html\\.\\w+\\s+)?\\.mx-reader-chrome${suffix}$`).test(selector.trim())))
    .map((match) => match[2]);

describe('the reader chrome stylesheet', () => {
  it('never hides the bar with a transform — its star is a fixed descendant', () => {
    const hidden = rootBlocks(STORY_CHROME_CSS, '--hidden');
    expect(hidden.length).toBeGreaterThan(0);
    for (const block of hidden) {
      expect(block).not.toMatch(/\btransform\s*:/);
      expect(block).not.toMatch(/\btranslate\s*:/);
    }
    // …and the bar itself carries no transform in any state, for the same reason.
    for (const block of [...rootBlocks(STORY_CHROME_CSS, ''), ...rootBlocks(STORY_CHROME_CSS, '--pinned')]) {
      expect(block).not.toMatch(/\btransform\s*:/);
    }
  });

  it('insets the document by the page\'s rail through a variable, beside the bars\' inset', () => {
    expect(STORY_CHROME_CSS).toMatch(/body\[data-mx-story-root\]\s*\{[^}]*padding-right:\s*var\(--mx-rail-inset,\s*0px\)/);
    // Desktop star participates in the action rail instead of floating.
    const desktop = STORY_CHROME_CSS.split('@media (min-width: 640px)')[1].split('@media (max-width: 639px)')[0];
    expect(desktop).toMatch(/\.mx-reader-github\s*\{[^}]*position:\s*static/);
  });
});

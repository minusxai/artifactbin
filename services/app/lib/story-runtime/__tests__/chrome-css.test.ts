/**
 * Two invariants of the reader chrome's stylesheet, each learned by watching
 * the product: the bar may never hide with a TRANSFORM (a transformed
 * ancestor is the containing block for `position: fixed` descendants, and the
 * bar's own star is one — it sat at the bar's bottom-right, the top of the
 * screen, for the 200ms of every slide and then jumped to the viewport's), and
 * the document leaves the page's comment rail its width the same way it leaves
 * the pinned bars their height: through a variable the page sets.
 */
import { describe, expect, it } from 'vitest';
import { STORY_CHROME_CSS } from '../chrome-css';

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

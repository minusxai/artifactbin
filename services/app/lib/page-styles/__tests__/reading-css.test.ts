/**
 * Two rules every served document's sheet carries, and the reasons they are the way they are:
 *
 *  - A TABLE hugs its content and never widens the page. Measured on a real
 *    document: a 3-column table at `w-full` inside a 342px phone column laid
 *    out at 497px and the third column was cut mid-word with nothing to say
 *    "scroll". The platform makes every table its own scroll box — capped at
 *    the column, scrolling inside — and a bare table sizes to its content
 *    rather than the column.
 *  - The base sheet never tests a subtree from the story root.
 */
import { describe, expect, it } from 'vitest';
import { STORY_TABLE_CSS } from '../chrome-css';
import { storyBaseCss } from '../story-base-css';

describe('tables', () => {
  it('every table is its own horizontal scroll box, capped at its column', () => {
    expect(STORY_TABLE_CSS).toMatch(/\[data-mx-story-root\]\)? table[^{]*\{[^}]*display:\s*block/);
    expect(STORY_TABLE_CSS).toMatch(/max-width:\s*100%/);
    expect(STORY_TABLE_CSS).toMatch(/overflow-x:\s*auto/);
  });

  it('sizes to its content by default — an author\'s w-full still wins (utilities outrank :where)', () => {
    expect(STORY_TABLE_CSS).toMatch(/width:\s*fit-content/);
    expect(STORY_TABLE_CSS).toMatch(/:where\(\[data-mx-story-root\]\) table/);
  });

  it('the kit DataTable opts out — it already scrolls inside its own box, and the box breaks its sticky header', () => {
    // A <thead position:sticky> pins to its nearest SCROLLING ancestor. Giving
    // the kit's table an overflow makes the TABLE that ancestor, so the header
    // pins to the full row stack and scrolls away with it. The kit renders its
    // own scroll box around the table, so the table needs no overflow of its own.
    expect(STORY_TABLE_CSS).toMatch(/table:not\(\[data-mx-kit-table\]\)/);
    expect(STORY_TABLE_CSS).not.toMatch(/\)\s*table\s*\{/);
  });

  it('shows a fade at the edge of a table that CAN scroll, and drops it once the reader has reached the end', () => {
    expect(STORY_TABLE_CSS).toContain('table[data-mx-scrollable]');
    expect(STORY_TABLE_CSS).toContain('table[data-mx-scrollable="end"]');
    expect(STORY_TABLE_CSS).toMatch(/mask-image/);
  });
});

describe('the served base sheet', () => {
  it('tests no subtree from the story root: a class change anywhere never restyles the whole page', () => {
    // `[data-mx-story-root]:not(:has([class]))` cost a 123 ms style pass per class change on a 28-table page.
    const sheet = storyBaseCss({ chrome: true, theme: null, faces: [], fonts: { families: [], slots: {} } });
    expect(sheet).not.toMatch(/\[data-mx-story-root\][^{]*:has\(/);
    expect(sheet).toContain(':where([data-mx-story-root]:not([data-mx-styled]))');
  });
});

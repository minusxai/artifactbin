/**
 * Two rules every served document carries, and the reasons they are the way
 * they are:
 *
 *  - A TABLE hugs its content and never widens the page. Measured on a real
 *    document: a 3-column table at `w-full` inside a 342px phone column laid
 *    out at 497px and the third column was cut mid-word with nothing to say
 *    "scroll". The platform makes every table its own scroll box — capped at
 *    the column, scrolling inside — and a bare table sizes to its content
 *    rather than the column.
 *  - The BARE typography floor steps its display sizes down on a phone: a
 *    2.5rem h1 is a headline on a laptop and a wall on a 390px screen.
 */
import { describe, expect, it } from 'vitest';
import { STORY_BARE_TYPOGRAPHY_CSS } from '@/lib/story-surface/bare-typography';
import { STORY_TABLE_CSS } from '@/lib/story-runtime/chrome-css';

describe('tables', () => {
  it('every table is its own horizontal scroll box, capped at its column', () => {
    expect(STORY_TABLE_CSS).toMatch(/\[data-mx-story-root\]\)? table\s*\{[^}]*display:\s*block/);
    expect(STORY_TABLE_CSS).toMatch(/max-width:\s*100%/);
    expect(STORY_TABLE_CSS).toMatch(/overflow-x:\s*auto/);
  });

  it('sizes to its content by default — an author\'s w-full still wins (utilities outrank :where)', () => {
    expect(STORY_TABLE_CSS).toMatch(/width:\s*fit-content/);
    expect(STORY_TABLE_CSS).toMatch(/:where\(\[data-mx-story-root\]\) table/);
  });

  it('shows a fade at the edge of a table that CAN scroll, and drops it once the reader has reached the end', () => {
    expect(STORY_TABLE_CSS).toContain('table[data-mx-scrollable]');
    expect(STORY_TABLE_CSS).toContain('table[data-mx-scrollable="end"]');
    expect(STORY_TABLE_CSS).toMatch(/mask-image/);
  });

  it('the bare floor no longer stretches an unstyled table to the column', () => {
    expect(STORY_BARE_TYPOGRAPHY_CSS).not.toMatch(/\(table\):not\(\[class\]\)\{[^}]*width:100%/);
  });
});

describe('the bare typography floor on a phone', () => {
  it('steps the display sizes down under 640px', () => {
    const phone = /@media \(max-width:\s*639px\)\{([^@]*)\}/.exec(STORY_BARE_TYPOGRAPHY_CSS)?.[1] ?? '';
    expect(phone).toMatch(/h1\)[^{]*\{font-size:2rem/);
    expect(phone).toMatch(/h2\)[^{]*\{font-size:1.5rem/);
  });

  it('touches only the bare elements — a styled document is unaffected', () => {
    const phone = /@media \(max-width:\s*639px\)\{([^@]*)\}/.exec(STORY_BARE_TYPOGRAPHY_CSS)?.[1] ?? '';
    for (const rule of phone.split('}').filter(Boolean)) expect(rule).toContain(':not([class])');
  });
});

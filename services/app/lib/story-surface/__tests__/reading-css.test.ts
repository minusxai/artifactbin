/**
 * The BARE typography floor: it steps its display sizes down on a phone (a 2.5rem h1 is a headline on a laptop
 * and a wall on a 390px screen) and leaves an unstyled table to the served table rule (lib/page-styles).
 */
import { describe, expect, it } from 'vitest';
import { STORY_BARE_TYPOGRAPHY_CSS } from '..';

describe('the bare typography floor and tables', () => {
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

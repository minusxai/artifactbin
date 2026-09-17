/**
 * THE FEATURED LIST IS CONTENT, AND CONTENT ROTS QUIETLY.
 *
 * Every rule here is a way the wall breaks without anyone noticing: a
 * relative address that 404s on a self-hosted instance, an id typo that
 * serves a grey box, a duplicate that shows the same document twice in one
 * row, a missing title. None of them throw — the page
 * renders, just wrong — so they are pinned rather than trusted.
 */
import { describe, expect, it } from 'vitest';

import { ID_RE } from '@/lib/ids-shape';
import { SHOWCASE, SHOWCASE_FORMATS, SHOWCASE_ORIGIN, showcaseHref } from '@/lib/showcase';

describe('the showcase list', () => {
  it('names real artifact ids, each one once', () => {
    expect(SHOWCASE.length).toBeGreaterThan(0);
    for (const doc of SHOWCASE) expect(doc.id).toMatch(ID_RE);
    // Placeholders deliberately BORROW a real document's picture, so only the
    // finished entries have to be distinct.
    const real = SHOWCASE.filter((d) => !d.placeholder).map((d) => d.id);
    expect(new Set(real).size).toBe(real.length);
  });

  it('is ordered by its order key, and no two entries claim the same rank', () => {
    const orders = SHOWCASE.map((d) => d.order);
    expect(new Set(orders).size).toBe(orders.length);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it('carries a title for every entry', () => {
    for (const doc of SHOWCASE) expect(doc.title.trim().length).toBeGreaterThan(0);
  });

  it('addresses the canonical instance ABSOLUTELY — a local instance has no such id', () => {
    for (const doc of SHOWCASE) {
      expect(showcaseHref(doc)).toBe(`${SHOWCASE_ORIGIN}/a/${doc.id}`);
      expect(showcaseHref(doc).startsWith('https://')).toBe(true);
    }
  });


});

/**
 * THE RAIL IS DERIVED, NEVER TYPED. It was a hand-written list in its own
 * order, so reordering the wall left the two disagreeing: the wheel ran
 * dashboard-first while the rail beside it still read data-story-first, and
 * nothing failed. A kind earns its place on the rail by a document HAVING it.
 */
describe('the format rail', () => {
  it('names each kind once, in the order the wall runs them', () => {
    // Derived, never spelled out: the curated sequence is edited often, and a
    // test that repeats it is a tax on editing rather than a guard on drift.
    const firstAppearance: string[] = [];
    for (const doc of SHOWCASE) if (!firstAppearance.includes(doc.kind)) firstAppearance.push(doc.kind);
    expect(SHOWCASE_FORMATS.map((f) => f.kind)).toEqual(firstAppearance);
  });

  it('covers every kind the curated set uses, and invents none', () => {
    const used = new Set(SHOWCASE.map((d) => d.kind));
    expect(new Set(SHOWCASE_FORMATS.map((f) => f.kind))).toEqual(used);
  });

  it('gives every one a plural label', () => {
    for (const format of SHOWCASE_FORMATS) expect(format.label).toBeTruthy();
  });
});

/**
 * THE FEATURED LIST IS CONTENT, AND CONTENT ROTS QUIETLY.
 *
 * Every rule here is a way the wall breaks without anyone noticing: a
 * relative address that 404s on a self-hosted instance, an id typo that
 * serves a grey box, a duplicate that shows the same document twice in one
 * row, a blurb someone left as a placeholder. None of them throw — the page
 * renders, just wrong — so they are pinned rather than trusted.
 */
import { describe, expect, it } from 'vitest';

import { ID_RE } from '@/lib/ids-shape';
import { SHOWCASE, SHOWCASE_ORIGIN, showcaseCardUrl, showcaseHref } from '@/lib/showcase';

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

  it('keeps every use phrase inside the one line the wheel gives it', () => {
    for (const doc of SHOWCASE) {
      expect(doc.use.trim().length).toBeGreaterThan(0);
      // Measured against the narrowest column the wheel runs in: past this
      // the phrase truncates mid-word beside its stem.
      expect(doc.use.length, doc.use).toBeLessThanOrEqual(48);
      expect(doc.use.endsWith('.')).toBe(false);
    }
  });

  it('carries a title and a one-sentence blurb for every entry', () => {
    for (const doc of SHOWCASE) {
      expect(doc.title.trim().length).toBeGreaterThan(0);
      expect(doc.blurb.trim().length).toBeGreaterThan(0);
      // One sentence: a card has one line of room, and a paragraph in it
      // truncates mid-word.
      expect(doc.blurb.length).toBeLessThanOrEqual(90);
      expect(doc.blurb.endsWith('.')).toBe(true);
    }
  });

  it('addresses the canonical instance ABSOLUTELY — a local instance has no such id', () => {
    for (const doc of SHOWCASE) {
      expect(showcaseHref(doc)).toBe(`${SHOWCASE_ORIGIN}/a/${doc.id}`);
      expect(showcaseHref(doc).startsWith('https://')).toBe(true);
    }
  });

  it('pictures a document with the document — its own public card capture, version-pinned', () => {
    for (const doc of SHOWCASE) {
      const url = showcaseCardUrl(doc);
      expect(url.startsWith(`${SHOWCASE_ORIGIN}/a/${doc.id}/export`)).toBe(true);
      expect(url).toContain('mode=card');
      expect(url).toContain(`v=${doc.version}`);
      // A 1600×840 PNG is ~800 KB for a picture drawn at 380px wide.
      expect(url).toContain('format=jpg');
    }
  });
});

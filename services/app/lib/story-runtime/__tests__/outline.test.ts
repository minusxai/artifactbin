/**
 * Outline discovery over the AST — the pure half of the document's own
 * table of contents (the reading twin of slides.ts). A document's `<h2>`s are
 * its sections and its `<h3>`s their parts; the outline is a walk of the nodes
 * the island already carries, so it is SERVER-rendered at its final size
 * exactly like the deck rail, and the first paint is the final geometry.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { discoverOutline, hasOutline, MIN_OUTLINE_SECTIONS } from '@/lib/story-runtime/outline';

const nodes = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};
const sections = (n: number, extra = '') =>
  '<article>' + Array.from({ length: n }, (_, i) => `<section><h2>Section ${i + 1}</h2><p>body</p>${extra}</section>`).join('') + '</article>';

describe('discoverOutline', () => {
  it('lists h2s in document order, nested anywhere, with the path an edit or a click can name', () => {
    const found = discoverOutline(nodes(sections(3)));
    expect(found.map((e) => [e.level, e.title])).toEqual([[2, 'Section 1'], [2, 'Section 2'], [2, 'Section 3']]);
    expect(found[1].path).toBe('0.1.0');
  });

  it('carries h3s as parts of the section before them', () => {
    const found = discoverOutline(nodes('<div><h2>A</h2><h3>A.1</h3><h3>A.2</h3><h2>B</h2></div>'));
    expect(found.map((e) => `${e.level}:${e.title}`)).toEqual(['2:A', '3:A.1', '3:A.2', '2:B']);
  });

  it('reads the heading TEXT — through inline markup and template literals — and skips an empty one', () => {
    const found = discoverOutline(nodes('<div><h2>1. <em>Claim</em> here</h2><h2>{`Literal`}</h2><h2>   </h2><h1>not a section</h1></div>'));
    expect(found.map((e) => e.title)).toEqual(['1. Claim here', 'Literal']);
  });

  it('ignores headings inside a <Slide> — a deck has its own rail', () => {
    const found = discoverOutline(nodes('<SlideDeck><Slide><h2>Cover</h2></Slide></SlideDeck><h2>After</h2>'));
    expect(found.map((e) => e.title)).toEqual(['After']);
  });
});

describe('hasOutline — when a document gets a table of contents', () => {
  it(`needs ${MIN_OUTLINE_SECTIONS} sections: two headings are a page, not a document`, () => {
    expect(hasOutline(nodes(sections(MIN_OUTLINE_SECTIONS - 1)))).toBe(false);
    expect(hasOutline(nodes(sections(MIN_OUTLINE_SECTIONS)))).toBe(true);
  });

  it('never for a deck (the slide rail is its navigation)', () => {
    const deck = '<SlideDeck>' + Array.from({ length: 4 }, (_, i) => `<Slide><h2>S${i}</h2></Slide>`).join('') + '</SlideDeck>';
    expect(hasOutline(nodes(deck))).toBe(false);
  });

  it('never for a dashboard laid out on a <Grid> — its h2s are tile titles, and its width is the point', () => {
    expect(hasOutline(nodes(`<Grid>${sections(4)}</Grid>`))).toBe(false);
    expect(hasOutline(nodes(sections(4) + '<Grid><GridItem><h2>tile</h2></GridItem></Grid>'))).toBe(false);
  });

  it('h3s alone are not sections', () => {
    expect(hasOutline(nodes('<div><h3>a</h3><h3>b</h3><h3>c</h3><h3>d</h3></div>'))).toBe(false);
  });
});

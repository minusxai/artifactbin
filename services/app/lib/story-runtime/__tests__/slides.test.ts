/**
 * Slide discovery over the AST — the pure half
 * of the document's own slide chrome. The title fallback chain is the contract
 * the old parent-side rail had, kept identical so decks read the same.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import type { JsxNode } from '@/lib/jsx';
import { discoverSlides, hasSlideRail } from '@/lib/story-runtime/slides';

const nodes = (source: string): JsxNode[] => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.nodes;
};

describe('discoverSlides', () => {
  it('finds slides in document order, nested inside a deck', () => {
    const found = discoverSlides(nodes(
      '<SlideDeck><Slide title="Cover"><h1>Hi</h1></Slide><Slide title="End"><p>bye</p></Slide></SlideDeck>',
    ));
    expect(found.map((s) => [s.index, s.title])).toEqual([[0, 'Cover'], [1, 'End']]);
  });

  it('falls back to the first heading, then to a positional name', () => {
    const found = discoverSlides(nodes(
      '<SlideDeck><Slide><div><h2>Derived heading</h2></div></Slide><Slide><p>no heading</p></Slide></SlideDeck>',
    ));
    expect(found.map((s) => s.title)).toEqual(['Derived heading', 'Slide 2']);
  });

  it('prefers an authored title over a heading', () => {
    const found = discoverSlides(nodes('<Slide title="Authored"><h1>Heading</h1></Slide>'));
    expect(found[0].title).toBe('Authored');
  });

  it('ignores an empty authored title', () => {
    const found = discoverSlides(nodes('<Slide title="   "><h1>Heading</h1></Slide>'));
    expect(found[0].title).toBe('Heading');
  });

  it('never mistakes <SlideDeck> for a slide', () => {
    expect(discoverSlides(nodes('<SlideDeck><p>no slides</p></SlideDeck>'))).toEqual([]);
  });

  it('carries the slide ELEMENT for the rail preview, classes and all', () => {
    // Its own classes ARE the composition; a preview of the children alone
    // shows every slide as top-left text.
    const found = discoverSlides(nodes('<Slide title="A" className="flex items-center justify-center"><h1>Title A</h1><p>body</p></Slide>'));
    expect(found[0].node.tag).toBe('Slide');
    expect(found[0].node.children).toHaveLength(2);
    expect(found[0].node.attributes.find((a) => a.name === 'className')?.value).toMatchObject({ static: true });
  });

  it('reads a heading built from a static expression child', () => {
    const found = discoverSlides(nodes('<Slide><h1>{`Expr heading`}</h1></Slide>'));
    expect(found[0].title).toBe('Expr heading');
  });
});

describe('hasSlideRail', () => {
  it('needs two slides — a single slide is just a document', () => {
    expect(hasSlideRail(nodes('<Slide title="only"><p>x</p></Slide>'))).toBe(false);
    expect(hasSlideRail(nodes('<Slide title="a"><p>x</p></Slide><Slide title="b"><p>y</p></Slide>'))).toBe(true);
    expect(hasSlideRail(nodes('<p>plain document</p>'))).toBe(false);
  });
});

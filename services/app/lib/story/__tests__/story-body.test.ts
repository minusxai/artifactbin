/**
 * ONE SPLIT, ONE TREE (lib/story/body).
 *
 * The served document and the live frame are two renderings of one source, and
 * the way they drift is by each doing the parse → nesting → split → asset
 * mapping for itself. This pins that `storyBodyFor` IS what both do: the nodes
 * the frame carries and the nodes the page renders are equal for the same
 * source and the same assets, and every pass that used to live in a caller
 * (the nesting repair, the Helmet split) still runs here.
 */
import { describe, expect, it } from 'vitest';
import { storyBodyFor } from '@/lib/story/body';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { assetUrlFor } from '@/lib/story/asset-url';

const URL_A = 'https://picsum.photos/id/237/300/200';
const FONT = 'https://fonts.example/Face.woff2';
const held = (u: string) => u === URL_A || u === FONT;

describe('storyBodyFor', () => {
  it('repairs nesting and splits the Helmet out', () => {
    const out = storyBodyFor('<Helmet><title>T</title></Helmet><p className="lede"><div>inner</div></p>')!;
    expect(out.content.title).toBe('T');
    expect(out.body).toHaveLength(1);
    const first = out.body[0];
    expect(first.type === 'element' && first.tag).toBe('div'); // the <p> could not hold a block
  });

  it('is null for source that does not parse', () => {
    expect(storyBodyFor('<div><p>unclosed')).toBeNull();
  });

  it('maps image sources and the author stylesheet\'s @font-face url', () => {
    const source = `<Helmet><style>{\`@font-face{font-family:F;src:url(${FONT}) format('woff2')}\`}</style></Helmet><img src="${URL_A}" alt="a" />`;
    const out = storyBodyFor(source, held)!;
    expect(JSON.stringify(out.body)).toContain(assetUrlFor(URL_A));
    expect(out.content.style).toContain(assetUrlFor(FONT));
    expect(out.content.style).not.toContain(FONT);
  });

  it('leaves everything alone when no lookup is given — the mapping is the CALLER\'s to ask for', () => {
    const source = `<img src="${URL_A}" alt="a" />`;
    expect(JSON.stringify(storyBodyFor(source)!.body)).toContain(URL_A);
  });

  it('is the SAME tree the live frame carries', () => {
    const source = `<div><img src="${URL_A}" alt="a" /><p>words</p></div>`;
    expect(storyUpdateParts(source, held)!.nodes).toEqual(storyBodyFor(source, held)!.body);
    expect(storyUpdateParts(source)!.nodes).toEqual(storyBodyFor(source)!.body);
  });
});

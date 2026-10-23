/**
 * The serve-time asset mapping must reach ALL THREE renderings of one document:
 * the SSR string, the island the client hydrates from, and the live frame an
 * open reader adopts. Those disagreeing is the whole risk, and the two callers
 * that build them go through one `storyBodyFor` (lib/document/body).
 *
 * The renderings are compared with a ROW MAP rather than a predicate, and that
 * is not cosmetic: everything a row carries — the versioned address, the box,
 * the blur, the second width — exists only when the lookup HAS a row, so a
 * comparison made with a bare predicate on both sides agrees about the one
 * thing that never differed and is blind to the rest.
 */
import { describe, expect, it } from 'vitest';
import { storyUpdateParts } from '@/lib/document/update-parts';
import { assetLookupFrom, assetUrlFor, mapExternalImageSources, type WebAssetBox } from '@/lib/document/asset-url';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const URL_A = 'https://picsum.photos/id/237/300/200';
// A component in the body so the document carries an island at all.
const SOURCE = `<div className="p-8"><img src="${URL_A}" alt="dog" /><Card><CardContent>x</CardContent></Card></div>`;
const ROW: WebAssetBox = {
  object_key: 'webasset/abcdef0102030405060708090a0b0c0d',
  width: 1600, height: 1200, placeholder: null,
  small_object_key: 'webasset/0102030405060708090a0b0c0d0e0f00', small_width: 640,
};
const rows = new Map([[URL_A, ROW]]);
const held = assetLookupFrom(rows);
const known = (u: string) => u === URL_A;

// `assetUrlFor` itself — the bare address, the `?v=` and the canonical URL —
// is asset-url.test.ts's subject. This file is about the three renderings agreeing.

describe('mapExternalImageSources', () => {
  it('rewrites a known url and leaves an unknown one', () => {
    const nodes = parseJsxOrThrow(`<div><img src="${URL_A}" /><img src="https://other.example/x.png" /></div>`);
    const out = JSON.stringify(mapExternalImageSources(nodes.nodes, known));
    expect(out).toContain(assetUrlFor(URL_A));
    expect(out).toContain('https://other.example/x.png');
    expect(out).not.toContain(URL_A);
  });
});

describe('the three renderings agree', () => {
  it('storyUpdateParts carries the mapped src too', () => {
    const parts = storyUpdateParts(SOURCE, held);
    expect(JSON.stringify(parts!.nodes)).toContain(assetUrlFor(URL_A, ROW));
    expect(JSON.stringify(parts!.nodes)).not.toContain(URL_A);
  });

  it('the live frame is node-for-node what the page renders — versions, variants and all', () => {
    const parts = storyUpdateParts(SOURCE, held);
    const parsed = parseJsxOrThrow(SOURCE);
    expect(parts!.nodes).toEqual(mapExternalImageSources(parsed.nodes, held));
  });

  it('the STORED source is untouched', () => {
    // the mapping is serve-time only: nothing here rewrites what was stored
    expect(SOURCE).toContain(URL_A);
  });

});

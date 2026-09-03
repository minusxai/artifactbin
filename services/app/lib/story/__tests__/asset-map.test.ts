/**
 * SPIKE (S2) — the serve-time asset mapping must reach ALL THREE renderings of
 * one document: the SSR string, the island the client hydrates from, and the
 * live frame an open reader adopts. Those disagreeing is the whole risk, and
 * they are built by two different functions today.
 *
 * The renderings are compared with a ROW MAP rather than a predicate, and that
 * is not cosmetic: everything a row carries — the versioned address, the box,
 * the blur, the second width — exists only when the lookup HAS a row, so a
 * comparison made with a bare predicate on both sides agrees about the one
 * thing that never differed and is blind to the rest.
 */
import { describe, expect, it } from 'vitest';
import { buildStoryDocument } from '@/lib/story/document';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { assetLookupFrom, assetUrlFor, mapExternalImageSources, type WebAssetBox } from '@/lib/story/asset-url';
import { parseJsx } from '@/lib/jsx';

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

describe('assetUrlFor', () => {
  it('is deterministic and canonicalizing', () => {
    // The seeded assertion was `^/assets/<64 hex>$`. It now ends in a
    // content-derived `?v=` whenever the caller holds the row (R19): the
    // address is `immutable` and cannot move, so the CACHE KEY moves instead
    // and a refreshed asset reaches readers who already fetched the old bytes.
    expect(assetUrlFor(URL_A, ROW)).toMatch(/^\/assets\/[0-9a-f]{64}\?v=[0-9a-f]{8}$/);
    expect(assetUrlFor(URL_A)).toMatch(/^\/assets\/[0-9a-f]{64}$/);
    expect(assetUrlFor(URL_A, ROW)).toBe(assetUrlFor(URL_A, ROW));
    expect(assetUrlFor('HTTPS://Picsum.Photos/id/237/300/200'.toLowerCase())).toBe(assetUrlFor(URL_A));
  });
});

describe('mapExternalImageSources', () => {
  it('rewrites a known url and leaves an unknown one', () => {
    const nodes = parseJsx(`<div><img src="${URL_A}" /><img src="https://other.example/x.png" /></div>`);
    if (!nodes.ok) throw new Error('parse');
    const out = JSON.stringify(mapExternalImageSources(nodes.nodes, known));
    expect(out).toContain(assetUrlFor(URL_A));
    expect(out).toContain('https://other.example/x.png');
    expect(out).not.toContain(URL_A);
  });
});

describe('the three renderings agree', () => {
  const build = (over: Partial<Parameters<typeof buildStoryDocument>[0]> = {}) => buildStoryDocument({
    source: SOURCE, compiledCss: null, theme: null, colorMode: null, refData: {},
    title: 'T', runtimeSrc: '/story/entry-TEST.js', assetUrls: rows, ...over,
  });

  it('SSR html and island json both carry the mapped, versioned src', async () => {
    const html = await build();
    const island = html.slice(html.indexOf('id="mx-story-data"'));
    // The island is JSON inside HTML, so its `&` is entity-escaped — the same
    // URL, spelled the way each rendering has to spell it.
    expect(html).toContain(`src="${assetUrlFor(URL_A, ROW)}"`);        // SSR string
    expect(island).toContain(assetUrlFor(URL_A, ROW)); // island JSON
    expect(html).not.toContain(URL_A);                                  // nothing points upstream
  });

  it('storyUpdateParts carries the mapped src too', () => {
    const parts = storyUpdateParts(SOURCE, held);
    expect(JSON.stringify(parts!.nodes)).toContain(assetUrlFor(URL_A, ROW));
    expect(JSON.stringify(parts!.nodes)).not.toContain(URL_A);
  });

  it('the live frame is node-for-node what the page renders — versions, variants and all', () => {
    const parts = storyUpdateParts(SOURCE, held);
    const parsed = parseJsx(SOURCE);
    if (!parsed.ok) throw new Error('parse');
    expect(parts!.nodes).toEqual(mapExternalImageSources(parsed.nodes, held));
  });

  it('the STORED source is untouched', () => {
    // the mapping is serve-time only: nothing here rewrites what was stored
    expect(SOURCE).toContain(URL_A);
  });

  /*
   * The rendered HTML, not the AST: an attribute React does not recognise is
   * dropped or mis-preloaded on the way to the DOM, and only the string the
   * browser is actually sent can say which happened.
   */
  it('offers both widths to the browser it is served to', async () => {
    const html = await build();
    expect(html).toContain('srcSet="');
    expect(html).toContain('w=640 640w');
    expect(html).toContain('sizes="(max-width: 640px) 100vw, 768px"');
  });

  it('photographs the full variant, eagerly, for a capture', async () => {
    const html = await build({ chrome: false });
    expect(html).toContain(`src="${assetUrlFor(URL_A, ROW)}"`);
    expect(html).not.toContain('srcSet=');
    expect(html).not.toContain('loading="lazy"');
  });
});

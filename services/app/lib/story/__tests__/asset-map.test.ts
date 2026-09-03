/**
 * SPIKE (S2) — the serve-time asset mapping must reach ALL THREE renderings of
 * one document: the SSR string, the island the client hydrates from, and the
 * live frame an open reader adopts. Those disagreeing is the whole risk, and
 * they are built by two different functions today.
 */
import { describe, expect, it } from 'vitest';
import { buildStoryDocument } from '@/lib/story/document';
import { storyUpdateParts } from '@/lib/story/update-parts';
import { assetUrlFor, mapExternalImageSources } from '@/lib/story/asset-url';
import { parseJsx } from '@/lib/jsx';

const URL_A = 'https://picsum.photos/id/237/300/200';
// A component in the body so the document carries an island at all.
const SOURCE = `<div className="p-8"><img src="${URL_A}" alt="dog" /><Card><CardContent>x</CardContent></Card></div>`;
const known = (u: string) => u === URL_A;

describe('assetUrlFor', () => {
  it('is deterministic and canonicalizing', () => {
    expect(assetUrlFor(URL_A)).toMatch(/^\/assets\/[0-9a-f]{64}$/);
    expect(assetUrlFor(URL_A)).toBe(assetUrlFor(URL_A));
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
  it('SSR html and island json both carry the mapped src', async () => {
    const html = await buildStoryDocument({
      source: SOURCE, compiledCss: null, theme: null, colorMode: null, refData: {},
      title: 'T', runtimeSrc: '/story/entry-TEST.js', assetUrls: new Set([URL_A]),
    });
    const island = html.slice(html.indexOf('id="mx-story-data"'));
    expect(html).toContain(`src="${assetUrlFor(URL_A)}"`);   // SSR string
    expect(island).toContain(assetUrlFor(URL_A));             // island JSON
    expect(html).not.toContain(URL_A);                        // nothing points upstream
  });

  it('storyUpdateParts carries the mapped src too', () => {
    const parts = storyUpdateParts(SOURCE, known);
    expect(JSON.stringify(parts!.nodes)).toContain(assetUrlFor(URL_A));
    expect(JSON.stringify(parts!.nodes)).not.toContain(URL_A);
  });

  it('the STORED source is untouched', () => {
    // the mapping is serve-time only: nothing here rewrites what was stored
    expect(SOURCE).toContain(URL_A);
  });
});

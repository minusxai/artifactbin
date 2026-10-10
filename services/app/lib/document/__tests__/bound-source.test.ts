/**
 * BOUND IMAGE SOURCES — the mapping half (lib/document/asset-url.ts). The grammar half (what counts as
 * a reference and what resolving one yields) is lib/dataflow/__tests__/bound-source.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { assetUrlFor, runtimeAssetUrl } from '@/lib/document/asset-url';

/**
 * THE MAPPING IS WHAT SAYS NO. A bound `src` is set by the runtime directly,
 * which means it goes round the interpreter's own dangerous-scheme filter
 * (`buildProps` drops the attribute; `RuntimeBoundSource` sets it again) — the
 * one defence-in-depth layer the interpreter's header promises to keep. The
 * served document's CSP and React's `javascript:` refusal do stop every shape
 * in practice, measured, but a backstop is not a mechanism: anything that is
 * not an absolute http(s) URL is not a source we can import, so the mapping
 * refuses it and the reader gets the alt text.
 */
describe('runtimeAssetUrl admits web URLs and exact uploaded references', () => {
  const known = () => false;
  const ENDPOINT = '/a/abc123/assets';

  it('maps an http(s) URL to the document endpoint', () => {
    expect(runtimeAssetUrl('https://cdn.x.com/cat.png', known, ENDPOINT))
      .toBe(`${ENDPOINT}?u=${encodeURIComponent('https://cdn.x.com/cat.png')}`);
    expect(runtimeAssetUrl('http://cdn.x.com/cat.png', known, ENDPOINT)).toContain('?u=');
  });

  it('answers null for every other shape a value can take', () => {
    for (const hostile of [
      '//cdn.x.com/cat.png',                    // protocol-relative: the browser's scheme, not ours
      'javascript:alert(1)',
      'data:image/svg+xml;base64,PHN2Zy8+',     // admitted by img-src, still not something we import
      '/local/path.png',
      'cat.png',
      'ref:bad',
      'FILE:///etc/passwd',
      '',
    ]) {
      expect(runtimeAssetUrl(hostile, known, ENDPOINT)).toBeNull();
    }
  });

  it('sends uploaded references through authorization, never a literal ref URL or the web cache',()=>{
    expect(runtimeAssetUrl('ref:abc123',()=>true,ENDPOINT)).toBe(`${ENDPOINT}?u=ref%3Aabc123`);
    expect(runtimeAssetUrl('ref:abc123',known,null)).toBeNull();
  });

  it('still answers our own address for a URL the caller knows we hold', () => {
    expect(runtimeAssetUrl('https://cdn.x.com/cat.png', () => true, ENDPOINT))
      .toBe(assetUrlFor('https://cdn.x.com/cat.png'));
  });

  it('leaves a web URL alone when there is no endpoint to import through', () => {
    expect(runtimeAssetUrl('https://cdn.x.com/cat.png', known, null)).toBe('https://cdn.x.com/cat.png');
  });

  it('appends to an endpoint that already carries a query (a capture\'s key)', () => {
    expect(runtimeAssetUrl('https://cdn.x.com/cat.png', known, `${ENDPOINT}?key=abc`))
      .toBe(`${ENDPOINT}?key=abc&u=${encodeURIComponent('https://cdn.x.com/cat.png')}`);
  });
});

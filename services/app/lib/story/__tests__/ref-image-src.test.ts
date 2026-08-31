/**
 * `ref:<id>` on an <img> resolves to the referenced artifact's URL — the ONE
 * helper both render paths use (the WYSIWYG canvas and the served document's
 * runtime). It exists because the runtime shipped without it once: the ref:
 * string reached the DOM verbatim, which is a broken image AND a CSP
 * violation (scripts/gate-full-kit.mjs caught it).
 */
import { describe, expect, it } from 'vitest';
import { resolveRefImageSrc, resolveRefProps, type RefDataMap } from '@/lib/story/ref-data';

const REF_DATA: RefDataMap = {
  img123: { kind: 'image', url: '/a/img123/raw?v=3' },
  rec99: { kind: 'viz', recipe: { description: 'r', engine: 'vega-lite', bindings: [], params: [], template: {} } as never },
};

describe('resolveRefImageSrc', () => {
  it('resolves a ref: pointing at an image artifact', () => {
    expect(resolveRefImageSrc('ref:img123', REF_DATA)).toBe('/a/img123/raw?v=3');
  });

  it('leaves plain URLs and data: images alone', () => {
    expect(resolveRefImageSrc('data:image/png;base64,AAA', REF_DATA)).toBeNull();
    expect(resolveRefImageSrc('/local.png', REF_DATA)).toBeNull();
  });

  it('does not resolve a ref of the wrong kind, or an unknown/deleted ref', () => {
    expect(resolveRefImageSrc('ref:rec99', REF_DATA)).toBeNull();
    expect(resolveRefImageSrc('ref:gone11', REF_DATA)).toBeNull();
  });

  it('tolerates a missing map and non-string values', () => {
    expect(resolveRefImageSrc('ref:img123', undefined)).toBeNull();
    expect(resolveRefImageSrc(undefined, REF_DATA)).toBeNull();
    expect(resolveRefImageSrc(42, REF_DATA)).toBeNull();
  });
});

describe('resolveRefProps — the one ref-patch for both render paths', () => {
  // Every position where markup carries `ref:<id>` that must become a URL at
  // render time, as ONE table: <img src> and <Video poster>. Both the WYSIWYG
  // canvas and the runtime call this from their decorateElement seam, so a
  // position resolving in one and not the other is exactly the drift this
  // prevents.
  it('patches an <img src="ref:…">', () => {
    expect(resolveRefProps({ isComponent: false, tag: 'img' }, { src: 'ref:img123' }, REF_DATA))
      .toEqual({ src: '/a/img123/raw?v=3' });
  });

  it('patches a <Video poster="ref:…">', () => {
    expect(resolveRefProps({ isComponent: true, tag: 'Video' }, { poster: 'ref:img123' }, REF_DATA))
      .toEqual({ poster: '/a/img123/raw?v=3' });
  });

  it('returns null when there is nothing to patch', () => {
    expect(resolveRefProps({ isComponent: false, tag: 'img' }, { src: '/plain.png' }, REF_DATA)).toBeNull();
    expect(resolveRefProps({ isComponent: true, tag: 'Video' }, { src: 'https://youtu.be/x' }, REF_DATA)).toBeNull();
    expect(resolveRefProps({ isComponent: false, tag: 'div' }, { src: 'ref:img123' }, REF_DATA)).toBeNull();
    expect(resolveRefProps({ isComponent: false, tag: 'video' }, { poster: 'ref:img123' }, REF_DATA)).toBeNull();
  });

  it('an unresolved ref stays unpatched — the component falls back, the string never reaches the DOM as a URL', () => {
    expect(resolveRefProps({ isComponent: true, tag: 'Video' }, { poster: 'ref:gone11' }, REF_DATA)).toBeNull();
  });
});

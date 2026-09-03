/**
 * The pure half of importing: WHICH external URLs a document names. Positions
 * are scoped on purpose — `<img src>` and `<Video poster>` are the two places
 * refs.ts already treats as image refs, and an `@font-face` `src` is the one
 * css position that may name one; a web URL anywhere else stays whatever the
 * validator says it is.
 *
 * There is no rewrite half any more: the URL an author wrote STAYS in the
 * stored document (lib/web-assets imports the bytes, lib/story/asset-url points
 * the served copy at ours).
 */
import { describe, expect, it } from 'vitest';
import { collectExternalAssetUrls, collectExternalFontUrls, collectExternalImageUrls } from '../external-images';

describe('collectExternalImageUrls', () => {
  it('finds https URLs on img src and Video poster, deduplicated, in order', () => {
    const src = `<div>
      <img src="https://a.example/one.png" />
      <img src="https://a.example/one.png" alt="again" />
      <Video src="https://www.youtube.com/watch?v=x" poster="https://a.example/two.jpg" />
      <img src="ref:abc123" />
      <img src="data:image/png;base64,xxxx" />
    </div>`;
    expect(collectExternalImageUrls(src)).toEqual([
      'https://a.example/one.png',
      'https://a.example/two.jpg',
    ]);
  });

  it('ignores web URLs OUTSIDE image positions — href is navigation, not an asset', () => {
    const src = '<div><a href="https://example.com/page">link</a><img src="https://example.com/i.png" /></div>';
    expect(collectExternalImageUrls(src)).toEqual(['https://example.com/i.png']);
  });

  it('ignores non-static and non-string src values, and unparseable sources', () => {
    expect(collectExternalImageUrls('<div><img /></div>')).toEqual([]);
    expect(collectExternalImageUrls('<div><<<')).toEqual([]);
  });

  it('collects http too — the guard decides its fate, not the collector', () => {
    expect(collectExternalImageUrls('<img src="http://example.com/i.png" />')).toEqual(['http://example.com/i.png']);
  });
});

describe('collectExternalFontUrls', () => {
  const doc = (css: string) => `<Helmet><style>{\`${css}\`}</style></Helmet><p>x</p>`;

  it('finds an @font-face src in the document\'s own stylesheet', () => {
    expect(collectExternalFontUrls(doc("@font-face{font-family:F;src:url(https://f.example/a.woff2) format('woff2')}")))
      .toEqual(['https://f.example/a.woff2']);
  });

  it('finds nothing in a document with no stylesheet, and nothing in a local url', () => {
    expect(collectExternalFontUrls('<p>x</p>')).toEqual([]);
    expect(collectExternalFontUrls(doc('@font-face{src:url(/local.woff2)}'))).toEqual([]);
  });
});

describe('collectExternalAssetUrls', () => {
  it('is both kinds, deduplicated', () => {
    const src = `<Helmet><style>{\`@font-face{src:url(https://f.example/a.woff2)}\`}</style></Helmet><img src="https://a.example/one.png" />`;
    expect(collectExternalAssetUrls(src)).toEqual({
      images: ['https://a.example/one.png'],
      fonts: ['https://f.example/a.woff2'],
      all: ['https://a.example/one.png', 'https://f.example/a.woff2'],
    });
  });
});

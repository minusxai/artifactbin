/**
 * The pure half of publish-time image importing: find the web URLs a document
 * carries in its image positions, and rewrite them to the refs they became.
 * Position-scoped on purpose — `<img src>` and `<Video poster>` are the two
 * places refs.ts already treats as image refs; a web URL anywhere else stays
 * whatever the validator says it is.
 */
import { describe, expect, it } from 'vitest';
import { collectExternalImageUrls, rewriteExternalImages } from '../external-images';

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

describe('rewriteExternalImages', () => {
  it('replaces each URL with its ref and leaves everything else byte-relevant intact', () => {
    const src = '<div className="p-4"><img src="https://a.example/one.png" alt="a" /><Video src="https://www.youtube.com/watch?v=x" poster="https://a.example/two.jpg" /></div>';
    const out = rewriteExternalImages(src, new Map([
      ['https://a.example/one.png', 'abc123'],
      ['https://a.example/two.jpg', 'def456'],
    ]));
    expect(out).toContain('src="ref:abc123"');
    expect(out).toContain('poster="ref:def456"');
    expect(out).not.toContain('a.example');
    expect(out).toContain('className="p-4"');
    expect(out).toContain('alt="a"');
    // The Video SRC is an allowlisted embed, not an image — untouched.
    expect(out).toContain('youtube.com/watch');
  });

  it('touches nothing when the map is empty', () => {
    const src = '<div><img src="ref:abc123" /></div>';
    expect(rewriteExternalImages(src, new Map())).toBe(src);
  });
});

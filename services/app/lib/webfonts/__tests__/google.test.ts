/**
 * The css2 parser — pure. Google's css2 endpoint answers @font-face blocks,
 * each preceded by a `/* subset *​/` comment; what we keep is latin +
 * latin-ext (the same cut the bundled @fontsource pipeline ships), with the
 * gstatic file URL, the weight (fixed or variable range), style and
 * unicode-range — everything a StoryFontAsset needs once the file is ours.
 */
import { describe, expect, it } from 'vitest';
import { parseGoogleFontCss } from '../google';

const CSS2 = `/* cyrillic */
@font-face {
  font-family: 'Lobster';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/lobster/v30/cyr.woff2) format('woff2');
  unicode-range: U+0301, U+0400-045F;
}
/* latin-ext */
@font-face {
  font-family: 'Lobster';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/lobster/v30/ext.woff2) format('woff2');
  unicode-range: U+0100-02BA, U+02BD-02C5;
}
/* latin */
@font-face {
  font-family: 'Lobster';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/lobster/v30/lat.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}`;

const VARIABLE = `/* latin */
@font-face {
  font-family: 'Bricolage Grotesque';
  font-style: italic;
  font-weight: 200 800;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/bricolage/v1/var.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`;

describe('parseGoogleFontCss', () => {
  it('keeps latin + latin-ext faces and drops the other subsets', () => {
    const faces = parseGoogleFontCss(CSS2);
    expect(faces).toHaveLength(2);
    expect(faces.map((f) => f.subset).sort()).toEqual(['latin', 'latin-ext']);
    const latin = faces.find((f) => f.subset === 'latin')!;
    expect(latin.family).toBe('Lobster');
    expect(latin.url).toBe('https://fonts.gstatic.com/s/lobster/v30/lat.woff2');
    expect(latin.weight).toBe('400');
    expect(latin.style).toBeUndefined(); // normal is the default, not a descriptor
    expect(latin.unicodeRange).toBe('U+0000-00FF, U+0131');
  });

  it('carries variable weight ranges and italic style through', () => {
    const [face] = parseGoogleFontCss(VARIABLE);
    expect(face.weight).toBe('200 800');
    expect(face.style).toBe('italic');
  });

  it('answers [] for css with no usable faces — an error page, an empty answer', () => {
    expect(parseGoogleFontCss('<!doctype html><html>nope</html>')).toEqual([]);
    expect(parseGoogleFontCss('')).toEqual([]);
    // faces without a subset label are skipped rather than guessed at
    expect(parseGoogleFontCss('@font-face { font-family: "X"; src: url(https://x/f.woff2); }')).toEqual([]);
  });

  it('ignores a face whose src is not a woff2 url', () => {
    const css = `/* latin */
@font-face { font-family: 'X'; font-weight: 400; src: url(https://fonts.gstatic.com/s/x/f.ttf) format('truetype'); unicode-range: U+0; }`;
    expect(parseGoogleFontCss(css)).toEqual([]);
  });
});

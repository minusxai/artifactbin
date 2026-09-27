/**
 * THE ENGINE'S DRAWING CARRIES THE PAGE'S FONTS TOO (components/kit/mermaid-fonts):
 * an `<img>` cannot reach the page's web fonts, so the kit puts the face files
 * the page already loaded (its @font-face rules; the bytes come from the HTTP
 * cache) into the drawing, whole, as `data:` URLs — the same faces a stored
 * drawing carries as subsets (lib/mermaid-images/fonts). A system-font drawing,
 * or bold text in a face bundled at one weight only, gets none: it draws as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedPageFonts, pageFontFaces } from '../kit/mermaid-fonts';

const SVG_NS = 'http://www.w3.org/2000/svg';
const drawing = ({ family = 'Inter,ui-sans-serif,sans-serif', edge = true, bold = false } = {}) => `<svg xmlns="${SVG_NS}" id="mx-mermaid-3" viewBox="0 0 100 40">`
  + `<style>#mx-mermaid-3{font-family:${family};font-size:16px;}</style>`
  + `<g class="nodes"><text>Request</text>${bold ? '<text style="font-weight: bold;">Read</text>' : ''}</g>`
  + (edge ? '<g class="edgeLabels"><g class="edgeLabel"><text>yes</text></g></g>' : '')
  + '<style>#mx-mermaid-3 .edgeLabels .edgeLabel text { font-family: "JetBrains Mono", monospace; }</style></svg>';
const LATIN = 'U+0000-00FF, U+0131';
const PAGE_CSS = `
@font-face { font-family: "Inter"; src: url("/fonts/inter-latin.woff2") format("woff2"); font-weight: 100 900; unicode-range: ${LATIN}; }
@font-face { font-family: "Inter"; src: url("/fonts/inter-latin-ext.woff2") format("woff2"); font-weight: 100 900; unicode-range: U+0100-02BA; }
@font-face { font-family: "JetBrains Mono"; src: url("/fonts/jbm-latin.woff2") format("woff2"); font-weight: 400; unicode-range: ${LATIN}; }
@font-face { font-family: "JetBrains Mono"; src: url("/fonts/jbm-latin.woff2") format("woff2"); font-weight: 700; unicode-range: ${LATIN}; }
@font-face { font-family: "Noto Serif"; src: url("/fonts/noto-serif-latin-400.woff2") format("woff2"); font-weight: 400; unicode-range: ${LATIN}; }`;
const fetchFont = vi.fn(async (url: string) => `data:font/woff2;base64,${btoa(url)}`);

function withPageCss() {
  const style = document.createElement('style');
  style.textContent = PAGE_CSS;
  document.head.appendChild(style);
  return style;
}
afterEach(() => { document.head.querySelectorAll('style').forEach((s) => s.remove()); fetchFont.mockClear(); });

describe('the page\'s own font faces', () => {
  it('are read from its @font-face rules: family, file, weights, range', () => {
    withPageCss();
    expect(pageFontFaces(document)).toEqual(expect.arrayContaining([
      { family: 'Inter', url: '/fonts/inter-latin.woff2', weight: '100 900', unicodeRange: expect.stringMatching(/^U\+0?0?00-0?0?FF/i) },
      { family: 'JetBrains Mono', url: '/fonts/jbm-latin.woff2', weight: '700', unicodeRange: expect.any(String) },
    ]));
  });
});

describe('an engine drawing carrying the page\'s fonts', () => {
  it('puts the face files it draws in first, as data URLs, and leaves the drawing untouched', async () => {
    withPageCss();
    const svg = drawing();
    const out = (await embedPageFonts(svg, { label: 'Inter', edge: 'JetBrains Mono' }, pageFontFaces(document), fetchFont))!;
    const open = `<svg xmlns="${SVG_NS}" id="mx-mermaid-3" viewBox="0 0 100 40">`;
    expect(out.startsWith(`${open}<style>@font-face{font-family:"Inter";src:url(data:font/woff2;base64,`)).toBe(true);
    expect(out.replace(/<style>@font-face[\s\S]*?<\/style>/, '')).toBe(svg);
    // Only the files covering its characters: Inter's Latin, not its Latin Extended; JetBrains Mono's one file, once.
    expect(fetchFont.mock.calls.map(([url]) => url).sort()).toEqual(['/fonts/inter-latin.woff2', '/fonts/jbm-latin.woff2']);
    // Laid out by this page as it renders here: no unhinted-text rule (that is the stored drawing's, which the harvest measured unhinted).
    expect(out).not.toContain('geometricPrecision');
  });

  it('carries no edge-label face without edge labels', async () => {
    withPageCss();
    await embedPageFonts(drawing({ edge: false }), { label: 'Inter', edge: 'JetBrains Mono' }, pageFontFaces(document), fetchFont);
    expect(fetchFont.mock.calls.map(([url]) => url)).toEqual(['/fonts/inter-latin.woff2']);
  });

  it('draws as before in a system font, and for bold text in a face the page has at one weight only', async () => {
    withPageCss();
    expect(await embedPageFonts(drawing({ family: 'ui-sans-serif,system-ui,sans-serif' }), { label: 'ui-sans-serif', edge: 'ui-monospace' }, pageFontFaces(document), fetchFont)).toBeNull();
    const serif = drawing({ family: '"Noto Serif",Georgia,serif', edge: false, bold: true });
    expect(await embedPageFonts(serif, { label: 'Noto Serif', edge: 'Noto Serif' }, pageFontFaces(document), fetchFont)).toBeNull();
    expect(await embedPageFonts(drawing({ family: '"Noto Serif",Georgia,serif', edge: false }), { label: 'Noto Serif', edge: 'Noto Serif' }, pageFontFaces(document), fetchFont)).toContain('font-family:"Noto Serif"');
  });

  it('draws as before when a face cannot be read (offline, blocked)', async () => {
    withPageCss();
    const failing = vi.fn(async () => { throw new Error('blocked'); });
    expect(await embedPageFonts(drawing(), { label: 'Inter', edge: 'JetBrains Mono' }, pageFontFaces(document), failing)).toBeNull();
  });
});

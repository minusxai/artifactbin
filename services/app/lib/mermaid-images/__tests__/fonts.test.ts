/**
 * A STORED DRAWING CARRIES ITS OWN FONTS (lib/mermaid-images/fonts): the
 * document's bundled web faces, subset to the drawing's own characters and
 * pinned to the weights it draws, as `data:font/woff2` in one leading
 * stylesheet — so an `<img>` of it renders in the theme's face on every
 * platform (an image cannot reach the page's fonts), and text is laid out at
 * unhinted advances (`text-rendering: geometricPrecision`) as the harvest
 * measured it. The block is the only CSS in a stored drawing that may name a
 * font file, and it is ours: families from the bundled manifest, bytes from
 * public/fonts (lib/mermaid-images/sanitize verifyEmbeddedMermaidSvg).
 */
import { describe, expect, it } from 'vitest';
import { embedMermaidFonts, MERMAID_FONT_BLOCK } from '../fonts';
import { verifyEmbeddedMermaidSvg } from '../sanitize';

const SVG_NS = 'http://www.w3.org/2000/svg';
/** The shape the kit's engine draws: the palette face on the root, the edge-label face in the document's rules. */
const drawing = ({ edge = true, bold = true, label = 'Request' } = {}) => `<svg xmlns="${SVG_NS}" id="mx-mermaid-1" viewBox="0 0 100 40">`
  + '<style>#mx-mermaid-1{font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:16px;}</style>'
  + `<g class="nodes"><text>${label}</text>${bold ? '<text style="font-weight: bold;">Read</text>' : ''}</g>`
  + (edge ? '<g class="edgeLabels"><g class="edgeLabel"><text>yes</text></g></g>' : '')
  + '<style>#mx-mermaid-1 .edgeLabels .edgeLabel text { font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 11px; }</style></svg>';
const FACES = { label: 'Inter', size: 16, edge: 'JetBrains Mono' };
const block = (svg: string) => MERMAID_FONT_BLOCK.exec(svg)?.[0] ?? '';
const faces = (svg: string) => [...block(svg).matchAll(/@font-face\{font-family:"([^"]+)";src:url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\) format\("woff2"\);font-weight:(\d+)/g)]
  .map(([, family, data, weight]) => ({ family, weight: Number(weight), bytes: Buffer.from(data!, 'base64').length }));

describe('embedding the document\'s fonts in a stored drawing', () => {
  it('puts one stylesheet first: each face it draws in, as a woff2 subset, and unhinted text; the drawing itself is untouched', async () => {
    const svg = drawing();
    const embedded = (await embedMermaidFonts(svg, FACES))!;
    expect(embedded).toMatch(new RegExp(`^<svg xmlns="${SVG_NS}" id="mx-mermaid-1" viewBox="0 0 100 40"><style>@font-face`));
    expect(embedded.replace(block(embedded), '')).toBe(svg);
    expect(block(embedded)).toContain('svg{text-rendering:geometricPrecision}');
    // The label face at the weights it is drawn in (bold labels), the edge-label face at its one weight.
    expect(faces(embedded).map(({ family, weight }) => `${family} ${weight}`).sort()).toEqual(['Inter 400', 'Inter 700', 'JetBrains Mono 400']);
  });

  it('subsets each face to the drawing\'s characters: a few KB, where the whole face is tens', async () => {
    const small = faces((await embedMermaidFonts(drawing(), FACES))!);
    for (const face of small) expect(face.bytes, `${face.family} ${face.weight}`).toBeLessThan(6_000);
    const more = faces((await embedMermaidFonts(drawing({ label: 'The quick brown fox jumps over the lazy dog, THE QUICK BROWN FOX' }), FACES))!);
    expect(more.find((f) => f.family === 'Inter' && f.weight === 400)!.bytes).toBeGreaterThan(small.find((f) => f.family === 'Inter' && f.weight === 400)!.bytes);
  });

  it('carries only the faces the drawing draws in: no edge-label face without edge labels, no bold without bold text', async () => {
    const embedded = (await embedMermaidFonts(drawing({ edge: false, bold: false }), FACES))!;
    expect(faces(embedded).map(({ family, weight }) => `${family} ${weight}`)).toEqual(['Inter 400']);
  });

  it('refuses a drawing in a face the app does not bundle: it would render per machine, so it is not stored', async () => {
    expect(await embedMermaidFonts(drawing(), { ...FACES, label: 'Georgia' })).toBeNull();
    expect(await embedMermaidFonts(drawing(), { ...FACES, edge: 'ui-monospace' })).toBeNull();
  });

  it('what it makes is exactly what the stored-drawing gate admits', async () => {
    const embedded = (await embedMermaidFonts(drawing(), FACES))!;
    expect(verifyEmbeddedMermaidSvg(embedded)).toBe(embedded);
  });
});

describe('the stored-drawing gate (verifyEmbeddedMermaidSvg)', () => {
  const ours = async () => (await embedMermaidFonts(drawing(), FACES))!;
  it('refuses a drawing without the block, and a block anywhere but first', async () => {
    expect(verifyEmbeddedMermaidSvg(drawing())).toBeNull();
    const svg = await ours();
    const moved = svg.replace(block(svg), '').replace('</svg>', `${block(svg)}</svg>`);
    expect(verifyEmbeddedMermaidSvg(moved)).toBeNull();
  });
  it.each([
    ['a font the page fetches', (b: string) => b.replace(/url\(data:font\/woff2;base64,[^)]+\)/, 'url(https://evil.example/f.woff2)')],
    ['another media type', (b: string) => b.replace('data:font/woff2;', 'data:image/svg+xml;')],
    ['a family the app does not bundle', (b: string) => b.replace('font-family:"Inter"', 'font-family:"Evil"')],
    ['any other rule', (b: string) => b.replace('svg{text-rendering:geometricPrecision}', 'svg{text-rendering:geometricPrecision}svg{background:red}')],
    ['a second block', (b: string) => b + b],
  ])('refuses a block with %s', async (_name, mutate) => {
    const svg = await ours();
    expect(verifyEmbeddedMermaidSvg(svg.replace(block(svg), mutate(block(svg))))).toBeNull();
  });
  it('refuses an @font-face or font url anywhere in the drawing after the block (an author\'s classDef)', async () => {
    const svg = await ours();
    expect(verifyEmbeddedMermaidSvg(svg.replace('</svg>', '<style>@font-face{font-family:x;src:url(data:font/woff2;base64,AAAA)}</style></svg>'))).toBeNull();
    expect(verifyEmbeddedMermaidSvg(svg.replace('</svg>', '<style>text{src:url(data:font/woff2;base64,AAAA)}</style></svg>'))).toBeNull();
  });
});

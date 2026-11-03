/**
 * KEPT FOR EXISTING PAGES ONLY (33 live pages on 3 Nov 2026). New pages use the direct libraries
 * (references/maps.md, diagrams.md). Delete together with ../html-components/mermaid.ts, mermaid-render.ts,
 * mermaid-fonts.ts, svg-text.ts, ../html-component-specs/mermaid-source.ts, their tests, the `mermaid` entry of
 * hosted.json `legacy` and the reader-draw path in scripts/lib/html-components-build.mjs once no live page uses
 * af-mermaid.
 *
 * af-mermaid's drawing, framework-free: the palette the element's theme resolves to (tokens as hex through a canvas
 * for portable image colors), the fonts it waits for, and the page's font files embedded when the drawing is made
 * entirely in them.
 */
import type { MermaidImage, MermaidPalette } from '@/lib/mermaid-images/mermaid-render';
import { embedPageFonts, pageFontFaces } from '@/lib/mermaid-images/mermaid-fonts';
import { inUnicodeRange, unquote } from '@/lib/mermaid-images/svg-text';

/** The characters the label faces are asked for and checked against, with the diagram's own. */
const FONT_PROBE = 'The quick brown fox jumps over the lazy dog 0123456789 THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG';

/**
 * The document's theme as a standalone SVG image needs it: concrete colors and
 * the font stacks the host element already renders in.
 */
export function paletteFor(element: HTMLElement, dark: boolean): MermaidPalette {
  const style = getComputedStyle(element);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d');
  const color = (name: string, fallback: string) => {
    if (!ctx) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = fallback;
    ctx.fillStyle = style.getPropertyValue(name).trim() || fallback;
    ctx.fillRect(0, 0, 1, 1);
    return '#' + [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3).map(v => v.toString(16).padStart(2, '0')).join('');
  };
  const size = Number.parseFloat(style.fontSize);
  // Labels sit between apparatus and body text: never below 12px, never above 16px.
  const labelPx = Number.isFinite(size) && size > 0 ? Math.round(Math.min(Math.max(size, 12), 16)) : 14;
  return {
    dark, background: color('--background', dark ? '#111827' : '#ffffff'),
    foreground: color('--foreground', dark ? '#f9fafb' : '#111827'),
    primary: color('--primary', '#2563eb'), border: color('--border', '#9ca3af'),
    card: color('--card', dark ? '#1f2937' : '#ffffff'),
    muted: color('--muted', dark ? '#1f2937' : '#f3f4f6'),
    accent: color('--accent', dark ? '#1f2937' : '#f3f4f6'),
    mutedForeground: color('--muted-foreground', dark ? '#9ca3af' : '#6b7280'),
    // The theme's own face as the browser resolved it here; a web font the
    // reader's machine lacks falls through the stack, as it does everywhere else.
    fontFamily: style.fontFamily.trim() || 'system-ui, sans-serif',
    fontMono: style.getPropertyValue('--font-mono').trim() || 'ui-monospace, Menlo, monospace',
    fontSize: labelPx + 'px',
  };
}

/** The diagram's characters beyond ASCII, once each: they may come from another face, or a subset that loads only when asked. */
const ownCharacters = (code: string): string => [...new Set(code.replace(/[\x00-\x7f]/g, ''))].sort().join('');

/** The face a font stack leads with, unquoted: the one it draws in when it has loaded. */
const firstFamily = (stack: string) => unquote(stack.split(',')[0] ?? '');

/**
 * Is this drawing made ENTIRELY in the document's web fonts — the label and
 * edge-label stacks each led by a face this page loaded, covering every
 * character asked for? Only then can the drawing carry its faces; a system
 * face or a fallback glyph resolves per machine.
 */
function drawnInWebFonts(palette: MermaidPalette, code: string): boolean {
  const fonts = typeof document !== 'undefined' ? document.fonts as (FontFaceSet & Iterable<FontFace>) | undefined : undefined;
  if (!fonts || typeof fonts[Symbol.iterator] !== 'function') return false;
  const faces = [...fonts];
  const points = [...new Set(FONT_PROBE + ownCharacters(code))].map((ch) => ch.codePointAt(0)!);
  return [palette.fontFamily, palette.fontMono].every((stack) => {
    const family = firstFamily(stack);
    const loaded = faces.filter((face) => face.status === 'loaded' && unquote(face.family) === family);
    return loaded.length > 0 && points.every((point) => loaded.some((face) => inUnicodeRange(face.unicodeRange, point)));
  });
}

const SVG_DATA = 'data:image/svg+xml;charset=utf-8,';
/** The engine's drawing with the page's font files in it, or as it was when it cannot carry them. */
async function withPageFonts(image: MermaidImage, palette: MermaidPalette): Promise<MermaidImage> {
  if (!image.src.startsWith(SVG_DATA)) return image;
  const svg = decodeURIComponent(image.src.slice(SVG_DATA.length));
  const embedded = await embedPageFonts(svg, { label: firstFamily(palette.fontFamily), edge: firstFamily(palette.fontMono) }, pageFontFaces());
  return embedded ? { ...image, src: SVG_DATA + encodeURIComponent(embedded) } : image;
}

/**
 * Wait (briefly) for the faces a palette draws with, so the engine lays a
 * drawing out in the fonts it will settle on. `document.fonts.ready` alone is not
 * enough: a face nothing has asked for yet is not pending, so `ready` can
 * resolve before the label face has even started loading. Asking for the
 * label and edge-label faces by name, with every character they will draw
 * (a `unicode-range` subset loads only for the characters asked for), loads
 * them — or resolves at once when the stack has no such web font.
 */
function fontsFor(palette: MermaidPalette, code: string): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load) return Promise.resolve();
  const text = FONT_PROBE + ownCharacters(code);
  const loaded = Promise.all([
    fonts.load(`${palette.fontSize} ${palette.fontFamily}`, text),
    fonts.load(`${palette.fontSize} ${palette.fontMono}`, text),
  ]).then(() => fonts.ready).then(() => undefined, () => undefined);
  return Promise.race([loaded, new Promise<void>(resolve => setTimeout(resolve, 3000))]);
}

/**
 * Draw `code` in `element`'s theme: wait for the palette's faces, draw, and embed the page's fonts in a drawing made
 * entirely in them. Resolves null once `live()` turns false; rejects when Mermaid cannot draw the source.
 */
export async function drawForReader(element: HTMLElement, code: string, dark: boolean, live: () => boolean): Promise<{ image: MermaidImage } | null> {
  let palette = paletteFor(element, dark);
  // Intentional engine split: Mermaid is large and browser-only.
  const [engine] = await Promise.all([import('@/lib/mermaid-images/mermaid-render'), fontsFor(palette, code)]);
  palette = paletteFor(element, dark);
  const image = await engine.renderMermaid(code, palette);
  if (!live()) return null;
  const after = paletteFor(element, dark);
  const shown = drawnInWebFonts(after, code) ? await withPageFonts(image, after) : image;
  if (!live()) return null;
  return { image: shown };
}

/**
 * A READER'S OWN MERMAID DRAWING, framework-free: the palette the document's theme resolves to (tokens as
 * hex, through a canvas — Mermaid's colour math cannot parse `oklch(...)`), the fonts it waits for, and
 * what a drawing is marked with for the harvest (lib/mermaid-images). ONE implementation for both readers:
 * today's React Mermaid (components/kit/mermaid) and the compiled reader's Solid one
 * (lib/islands/kit/mermaid) draw through `drawForReader`, so they draw and mark identically.
 */
import { sha256Hex } from '@/lib/sha256';
import { METRICS_PROBE, formatMermaidFaces, formatMermaidMetrics, parseMermaidFaces, parseMermaidMetrics, type MermaidMetrics } from '@/lib/mermaid-images/drawn';
import type { MermaidImage, MermaidPalette } from '@/lib/mermaid-images/mermaid-render';
import { embedPageFonts, pageFontFaces } from '@/lib/mermaid-images/mermaid-fonts';

/**
 * The document's theme as Mermaid needs it: tokens resolved to hex (its colour
 * math expects hex, and modern CSS colours would not parse), plus the type the
 * host element already renders in.
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

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The diagram's characters beyond ASCII, once each: they may come from another face, or a subset that loads only when asked. */
const ownCharacters = (code: string): string => [...new Set(code.replace(/[\x00-\x7f]/g, ''))].sort().join('');

/**
 * The palette's key: every field Mermaid is configured with. With the faces'
 * measurements, it tells whether the fonts held still while a drawing was
 * made (only then is it marked for the harvest, lib/mermaid-images/drawn).
 */
export function mermaidPaletteKey(palette: MermaidPalette): string {
  const fields = [palette.dark, palette.background, palette.foreground, palette.primary, palette.border, palette.card,
    palette.muted, palette.accent, palette.mutedForeground, palette.fontFamily, palette.fontMono, palette.fontSize];
  return sha256Hex(JSON.stringify(fields)).slice(0, 32);
}

/**
 * WHAT MERMAID WOULD MEASURE HERE: the SVG text box — width, height and y,
 * what Mermaid's own label measurement reads — of the label face at the label
 * size and of the edge-label face at its 11px (lib/mermaid-images/mermaid-render
 * documentStyles), over a fixed Latin probe plus the diagram's own other
 * characters. Measured in the page, as Mermaid measures, so every platform
 * difference that moves a drawing shows here: hinted (whole-pixel) advances,
 * another engine's line box, a system face another machine lacks. Null where
 * nothing lays text out (jsdom).
 */
function measureFaces(palette: MermaidPalette, code: string): MermaidMetrics | null {
  if (typeof document === 'undefined' || !document.body) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('style', 'position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: hidden; visibility: hidden;');
  const text = METRICS_PROBE + ownCharacters(code).slice(0, 256);
  document.body.appendChild(svg);
  try {
    const box = (fontFamily: string, fontSize: string): number[] | null => {
      const label = document.createElementNS(SVG_NS, 'text') as SVGTextElement;
      label.setAttribute('style', `font-family: ${fontFamily}; font-size: ${fontSize};`);
      label.textContent = text;
      svg.appendChild(label);
      if (typeof label.getBBox !== 'function') return null;
      const { width, height, y } = label.getBBox();
      return [width, height, y];
    };
    const label = box(palette.fontFamily, palette.fontSize);
    const edge = box(palette.fontMono, '11px');
    return label && edge ? parseMermaidMetrics([...label, ...edge].join(',')) : null;
  } finally {
    svg.remove();
  }
}

// Quotes as escapes: the kit's class extraction (lib/story-ui/recipe-classes) reads this file as text.
const unquote = (family: string) => family.trim().replace(/^[\x22\x27]|[\x22\x27]$/g, '');
/** The face a font stack leads with, unquoted: the one it draws in when it has loaded. */
const firstFamily = (stack: string) => unquote(stack.split(',')[0] ?? '');

/**
 * The faces a drawing is drawn in, as the harvest records them for the server
 * (lib/mermaid-images/readers): the label face at its size, the edge-label face.
 */
export const facesOf = (palette: MermaidPalette): string | undefined => {
  const faces = parseMermaidFaces(formatMermaidFaces({ label: firstFamily(palette.fontFamily), size: Number.parseFloat(palette.fontSize), edge: firstFamily(palette.fontMono) }));
  return faces ? formatMermaidFaces(faces) : undefined;
};

/** A `unicode-range` descriptor holds this code point (`U+0-FF, U+131, U+4??`). */
function inUnicodeRange(range: string, point: number): boolean {
  return (range || 'U+0-10FFFF').split(',').some((part) => {
    const match = /^\s*U\+([0-9a-f?]+)(?:-([0-9a-f]+))?\s*$/i.exec(part);
    if (!match) return false;
    const low = Number.parseInt(match[1]!.replace(/\?/g, '0'), 16);
    const high = Number.parseInt(match[2] ?? match[1]!.replace(/\?/g, 'f'), 16);
    return point >= low && point <= high;
  });
}

/**
 * Is this drawing made ENTIRELY in the document's web fonts — the label and
 * edge-label stacks each led by a face this page loaded, covering every
 * character measured? Only then can a stored drawing carry its faces
 * (lib/mermaid-images/fonts); a system face or a fallback glyph resolves per
 * machine, so such a drawing is never stored.
 */
export function drawnInWebFonts(palette: MermaidPalette, code: string): boolean {
  const fonts = typeof document !== 'undefined' ? document.fonts as (FontFaceSet & Iterable<FontFace>) | undefined : undefined;
  if (!fonts || typeof fonts[Symbol.iterator] !== 'function') return false;
  const faces = [...fonts];
  const points = [...new Set(METRICS_PROBE + ownCharacters(code))].map((ch) => ch.codePointAt(0)!);
  return [palette.fontFamily, palette.fontMono].every((stack) => {
    const family = firstFamily(stack);
    const loaded = faces.filter((face) => face.status === 'loaded' && unquote(face.family) === family);
    return loaded.length > 0 && points.every((point) => loaded.some((face) => inUnicodeRange(face.unicodeRange, point)));
  });
}

const SVG_DATA = 'data:image/svg+xml;charset=utf-8,';
/** The engine's drawing with the page's font files in it, or as it was when it cannot carry them. */
export async function withPageFonts(image: MermaidImage, palette: MermaidPalette): Promise<MermaidImage> {
  if (!image.src.startsWith(SVG_DATA)) return image;
  const svg = decodeURIComponent(image.src.slice(SVG_DATA.length));
  const embedded = await embedPageFonts(svg, { label: firstFamily(palette.fontFamily), edge: firstFamily(palette.fontMono) }, pageFontFaces());
  return embedded ? { ...image, src: SVG_DATA + encodeURIComponent(embedded) } : image;
}

/** Does this page ask for the engine by name (`?mermaid=engine`, lib/mermaid-images/store MERMAID_ENGINE_PARAM)? */
export const engineAskedFor = (): boolean => typeof location !== 'undefined' && new URLSearchParams(location.search).get('mermaid') === 'engine';

/** What this browser would draw with — the palette's key and the faces' measurements. */
export interface Measured { palette: string; metrics: MermaidMetrics | null }
export const measured = (palette: MermaidPalette, code: string): Measured => ({ palette: mermaidPaletteKey(palette), metrics: measureFaces(palette, code) });
export const sameMeasure = (a: Measured, b: Measured) => a.palette === b.palette && (a.metrics && formatMermaidMetrics(a.metrics)) === (b.metrics && formatMermaidMetrics(b.metrics));

/**
 * Wait (briefly) for the faces a palette draws with, so the engine lays a
 * drawing out in the fonts it will settle on. `document.fonts.ready` alone is not
 * enough: a face nothing has asked for yet is not pending, so `ready` can
 * resolve before the label face has even started loading. Asking for the
 * label and edge-label faces by name, with every character they will measure
 * (a `unicode-range` subset loads only for the characters asked for), loads
 * them — or resolves at once when the stack has no such web font.
 */
export function fontsFor(palette: MermaidPalette, code: string): Promise<void> {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts?.load) return Promise.resolve();
  const text = METRICS_PROBE + ownCharacters(code);
  const loaded = Promise.all([
    fonts.load(`${palette.fontSize} ${palette.fontFamily}`, text),
    fonts.load(`11px ${palette.fontMono}`, text),
  ]).then(() => fonts.ready).then(() => undefined, () => undefined);
  return Promise.race([loaded, new Promise<void>(resolve => setTimeout(resolve, 3000))]);
}

/** An engine drawing, and — when the fonts held still while it was drawn — what it was drawn under, for the harvest. */
export type Drawn = { code: string; image?: MermaidImage; error?: string; palette?: string; metrics?: string; portable?: boolean; faces?: string };

/** A reader's drawing and its marks: what React's `draw()` puts in its result (minus the code it was drawn for). */
export type ReaderDrawing = Omit<Drawn, 'code' | 'error'> & { image: MermaidImage };

/**
 * Draw `code` in `element`'s theme, as today's reader does: wait for the palette's faces, measure them
 * before and after, embed the page's fonts in a portable drawing, and mark the drawing (palette key,
 * metrics, faces) only when the fonts held still. Resolves null once `live()` turns false; rejects
 * when Mermaid cannot draw the source.
 */
export async function drawForReader(element: HTMLElement, code: string, dark: boolean, live: () => boolean): Promise<ReaderDrawing | null> {
  if (engineAskedFor()) document.documentElement.style.setProperty('text-rendering', 'geometricPrecision');
  let palette = paletteFor(element, dark);
  // Intentional engine split: Mermaid is large and browser-only.
  const [engine] = await Promise.all([import('@/lib/mermaid-images/mermaid-render'), fontsFor(palette, code)]);
  palette = paletteFor(element, dark);
  const before = measured(palette, code);
  const image = await engine.renderMermaid(code, palette);
  if (!live()) return null;
  const after = paletteFor(element, dark);
  const now = measured(after, code);
  const portable = drawnInWebFonts(after, code);
  const shown = portable && !engineAskedFor() ? await withPageFonts(image, after) : image;
  if (!live()) return null;
  return { image: shown, ...(sameMeasure(before, now) ? {
    palette: now.palette, ...(now.metrics ? { metrics: formatMermaidMetrics(now.metrics) } : {}), portable, faces: facesOf(after),
  } : {}) };
}

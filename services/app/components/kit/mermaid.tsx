import { createContext, useContext, useEffect, useMemo, useRef, useState, type HTMLAttributes } from 'react';
import { cn } from './cn';
import { GridItemContext } from './grid';
import { mermaidImageKey, mermaidSourceError } from '@/lib/story-ui/mermaid-source';
import { sha256Hex } from '@/lib/sha256';
import { METRICS_PROBE, formatMermaidFaces, formatMermaidMetrics, parseMermaidFaces, parseMermaidMetrics, storedDrawingFits, type MermaidMetrics } from '@/lib/mermaid-images/match';
import type { StoredMermaidImage } from '@/lib/story-runtime/contract';
import type { MermaidImage, MermaidPalette } from './mermaid-render';

interface MermaidProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  code: string;
  title?: string;
  colorMode?: 'light' | 'dark';
}

/**
 * The document's PRERENDERED drawings (StoryIslandData.mermaidImages), keyed by
 * `mermaidImageKey(code, mode)`. Provided around everything a document draws —
 * the deck rail re-renders each slide's nodes — and empty wherever nothing was
 * stored: an editor's draft, an offline file, a document the harvest has not
 * reached. Empty means exactly today's path: the engine draws.
 */
const MermaidImagesContext = createContext<Readonly<Record<string, StoredMermaidImage>>>({});
export const MermaidImagesProvider = MermaidImagesContext.Provider;

/**
 * The document's theme as Mermaid needs it: tokens resolved to hex (its colour
 * math expects hex, and modern CSS colours would not parse), plus the type the
 * host element already renders in.
 */
function paletteFor(element: HTMLElement, dark: boolean): MermaidPalette {
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
 * The palette's key: every field Mermaid is configured with. Two browsers draw
 * the same code identically only when this AND their measurements agree
 * (lib/mermaid-images/match).
 */
function mermaidPaletteKey(palette: MermaidPalette): string {
  const fields = [palette.dark, palette.background, palette.foreground, palette.primary, palette.border, palette.card,
    palette.muted, palette.accent, palette.mutedForeground, palette.fontFamily, palette.fontMono, palette.fontSize];
  return sha256Hex(JSON.stringify(fields)).slice(0, 32);
}

/**
 * WHAT MERMAID WOULD MEASURE HERE: the SVG text box — width, height and y,
 * what Mermaid's own label measurement reads — of the label face at the label
 * size and of the edge-label face at its 11px (components/kit/mermaid-render
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

const unquote = (family: string) => family.trim().replace(/^(["'])(.*)\1$/, '$2');
/** The face a font stack leads with, unquoted: the one it draws in when it has loaded. */
const firstFamily = (stack: string) => unquote(stack.split(',')[0] ?? '');

/**
 * The faces a drawing is drawn in, as the harvest records them for the server
 * (lib/mermaid-images/readers): the label face at its size, the edge-label face.
 */
const facesOf = (palette: MermaidPalette): string | undefined => {
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
 * character measured? Then every reader loads the same font files, and a
 * drawing the harvest made can be the reader's (lib/mermaid-images/match); a
 * system face or a fallback glyph resolves per machine, so such a drawing is
 * never stored.
 */
function drawnInWebFonts(palette: MermaidPalette, code: string): boolean {
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

/** What this browser would draw with — the palette's key and the faces' measurements. */
interface Measured { palette: string; metrics: MermaidMetrics | null }
const measured = (palette: MermaidPalette, code: string): Measured => ({ palette: mermaidPaletteKey(palette), metrics: measureFaces(palette, code) });
const sameMeasure = (a: Measured, b: Measured) => a.palette === b.palette && (a.metrics && formatMermaidMetrics(a.metrics)) === (b.metrics && formatMermaidMetrics(b.metrics));

/**
 * Wait (briefly) for the faces a palette draws with, so a stored drawing is
 * judged by the fonts it will settle on. `document.fonts.ready` alone is not
 * enough: a face nothing has asked for yet is not pending, so `ready` can
 * resolve before the label face has even started loading. Asking for the
 * label and edge-label faces by name, with every character they will measure
 * (a `unicode-range` subset loads only for the characters asked for), loads
 * them — or resolves at once when the stack has no such web font.
 */
function fontsFor(palette: MermaidPalette, code: string): Promise<void> {
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
type Drawn = { code: string; image?: MermaidImage; error?: string; palette?: string; metrics?: string; portable?: boolean; faces?: string };

export function Mermaid({ code, title = 'Diagram', colorMode = 'light', className, ...props }: MermaidProps) {
  const host = useRef<HTMLElement>(null);
  const img = useRef<HTMLImageElement>(null);
  // Inside a grid cell the tile owns the size: the figure fills it and the
  // drawing scales to fit; in prose the drawing keeps its own layout size.
  const inGridItem = useContext(GridItemContext);
  const images = useContext(MermaidImagesContext);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<Drawn | null>(null);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  // A stored drawing this reader cannot use (another palette, or its bytes
  // would not load): the engine draws instead, as it would with none stored.
  const [refused, setRefused] = useState<string | null>(null);
  const invalid = mermaidSourceError(code);
  const imageKey = useMemo(() => (invalid ? null : mermaidImageKey(code, colorMode)), [code, colorMode, invalid]);
  const offered = imageKey ? images[imageKey] : undefined;
  const stored = offered && offered.src !== refused ? offered : undefined;
  const storedSrc = stored?.src ?? null;
  const storedPalette = stored?.palette ?? null;
  const storedMetrics = stored?.metrics ? stored.metrics.join(',') : null;
  useEffect(() => {
    // Only a CHANGED value redraws: the reader's adopted story is re-stamped with
    // the theme it already has (lib/story-runtime/InlineStoryRuntime), and each
    // such write used to draw every diagram again.
    const observer = new MutationObserver(records => {
      if (records.some(record => record.oldValue !== (record.target as Element).getAttribute(record.attributeName ?? ''))) setRevision(n => n + 1);
    });
    for (let element = host.current?.parentElement; element; element = element.parentElement) {
      observer.observe(element, { attributes: true, attributeOldValue: true, attributeFilter: ['data-theme', 'data-color-mode', 'class'] });
    }
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (invalid || !host.current) return;
    let active = true;
    const element = host.current;
    const draw = () => {
      // Mermaid lays labels out by measuring them, so it measures once the
      // palette's own faces have loaded (fontsFor, at most 3s): otherwise a
      // diagram drawn during hydration, before a web face arrives, is laid out
      // in its fallback — a drawing that depends on the network's timing.
      let palette = paletteFor(element, colorMode === 'dark');
      let before: Measured | null = null;
      // Intentional engine split: Mermaid is large and browser-only.
      void Promise.all([import('./mermaid-render'), fontsFor(palette, code)]).then(([engine]) => {
        palette = paletteFor(element, colorMode === 'dark');
        before = measured(palette, code);
        return engine.renderMermaid(code, palette);
      }).then(
        // The drawing is marked with what it was drawn under only when the fonts
        // measured the same before and after it was drawn: a face that landed
        // mid-draw leaves no telling which metrics Mermaid laid it out with, and
        // the harvest (lib/mermaid-images) then stores nothing for it.
        image => {
          if (!active) return;
          const after = paletteFor(element, colorMode === 'dark');
          const now = measured(after, code);
          setResult({ code, image, ...(before && sameMeasure(before, now) ? {
            palette: now.palette, ...(now.metrics ? { metrics: formatMermaidMetrics(now.metrics) } : {}), portable: drawnInWebFonts(after, code), faces: facesOf(after),
          } : {}) });
        },
        () => { if (active) setResult({ code, error: 'Could not render this diagram. Check its Mermaid syntax.' }); },
      );
    };
    if (!storedSrc) {
      setResult(null);
      draw();
      return () => { active = false; };
    }
    // A stored drawing is already on screen (the server rendered it). It stays
    // while this browser checks it would have drawn the same thing; only a
    // different palette or measurement brings the engine in.
    void fontsFor(paletteFor(element, colorMode === 'dark'), code).then(() => {
      if (!active) return;
      const reader = measured(paletteFor(element, colorMode === 'dark'), code);
      const drawnUnder = { palette: storedPalette ?? '', ...(storedMetrics !== null ? { metrics: storedMetrics.split(',').map(Number) } : {}) };
      if (storedDrawingFits(drawnUnder, reader)) setResult(null);
      else draw();
    });
    return () => { active = false; };
  }, [code, colorMode, invalid, revision, storedSrc, storedPalette, storedMetrics]);
  const current = result?.code === code ? result : null;
  const error = invalid || current?.error;
  const image: MermaidImage | undefined = current?.image ?? stored;
  const src = image?.src ?? null;
  // An image that finished (or failed) before hydration fired its event into
  // nothing: read the element's own state once it is ours.
  useEffect(() => {
    const element = img.current;
    if (!element || !src || !element.complete) return;
    if (element.naturalWidth > 0) setLoadedSrc(src);
    else if (src === storedSrc) setRefused(src);
  }, [src, storedSrc]);
  const onLoad = () => { if (src) setLoadedSrc(src); };
  const onError = () => {
    if (src && src === storedSrc) setRefused(src);
    else setResult({ code, error: 'Could not display this diagram.' });
  };
  const engineDrawn = !!current?.image && !!current.palette;
  // The source is not shown here: in edit mode the diagram inspector holds it.
  return <figure {...props} ref={host} className={cn('min-w-0', inGridItem ? 'flex h-full w-full flex-col' : 'my-4', className)}
    data-mx-mermaid-state={error ? 'error' : image && loadedSrc === image.src ? 'ready' : 'pending'} data-mermaid-type={image?.type}
    // What the engine drew here, and under which palette — read by the harvest
    // (lib/mermaid-images) to store it. Client-only: the server never draws.
    data-mx-mermaid-key={engineDrawn && imageKey ? imageKey : undefined} data-mx-mermaid-palette={engineDrawn ? current?.palette : undefined}
    data-mx-mermaid-metrics={engineDrawn ? current?.metrics : undefined} data-mx-mermaid-portable={engineDrawn && current?.portable ? '' : undefined}
    data-mx-mermaid-faces={engineDrawn ? current?.faces : undefined}>
    {/* In a tile the title is chart chrome, like a Question's; in prose it is a caption. */}
    <figcaption className={inGridItem ? 'border-b border-border px-3 py-2 font-mono text-sm font-medium' : 'mb-2 font-mono text-sm font-medium'}>{title}</figcaption>
    {error ? <p role="alert" className={cn('text-sm text-destructive', inGridItem && 'p-3')}>{error}</p> : image ?
      inGridItem
        ? <img ref={img} width={image.width} height={image.height} src={image.src} alt={title} className="min-h-0 w-full flex-1 object-contain p-3" onLoad={onLoad} onError={onError} />
        : <img ref={img} width={image.width} height={image.height} style={{ width: image.width, maxWidth: '100%', height: 'auto' }} src={image.src} alt={title} className="block h-auto max-w-full" onLoad={onLoad} onError={onError} /> :
      <p role="status" className={cn('text-sm text-muted-foreground', inGridItem && 'p-3')}>Rendering diagram…</p>}
  </figure>;
}

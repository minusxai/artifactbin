/**
 * KEPT FOR EXISTING PAGES ONLY (33 live pages on 3 Nov 2026). New pages use the direct libraries
 * (references/maps.md, diagrams.md). Delete together with ../html-components/mermaid.ts, reader-draw.ts,
 * mermaid-fonts.ts, svg-text.ts, ../html-component-specs/mermaid-source.ts, their tests, the `mermaid` entry of hosted.json `legacy` and the reader-draw path in
 * scripts/lib/html-components-build.mjs once no live page uses af-mermaid.
 *
 * af-mermaid's lazy browser engine boundary: Mermaid is the diagram syntax; Pele is the only drawing runtime.
 */
import {render} from 'pele';
import {mermaidSourceError} from '@/lib/html-component-specs/mermaid-source';

/** The document's resolved theme colours and host typography for portable SVG images. */
export interface MermaidPalette {
  background: string;
  foreground: string;
  primary: string;
  border: string;
  /** Node fill — the theme's card surface. */
  card: string;
  /** Group/cluster fill — the theme's muted surface. */
  muted: string;
  /** The theme's quiet surface tint (`--accent`, never the accent colour) — notes and subgraphs. */
  accent: string;
  /** Edges, arrowheads and edge labels. */
  mutedForeground: string;
  /** The host element's resolved font stack and a clamped label size (`13px`). */
  fontFamily: string;
  fontSize: string;
  /** The theme's utility face (`--font-mono`), for edge labels. */
  fontMono: string;
  dark: boolean;
}
export interface MermaidImage { src: string; type: string; width?: number; height?: number }

let nextId = 0;

/** Preserve the saved image contract while drawing with Pele. Variables live on
 * the SVG itself: an <img> cannot inherit the containing document's CSS. */
export async function renderMermaid(code: string, palette: MermaidPalette): Promise<MermaidImage> {
  const error = mermaidSourceError(code);
  if (error) throw new Error(error);
  const id = `mx-mermaid-${++nextId}`;
  const size = Number.parseFloat(palette.fontSize);
  const result = render(code, {
    idPrefix: id,
    fontFamily: palette.fontFamily,
    fontFamilyMono: palette.fontMono,
    fontSize: Number.isFinite(size) && size > 0 ? size : 14,
    limit: 20_000, maxEdges: 500,
    // Retained image renderers never exposed active links or remote images.
    links: false, images: false,
    autoDirection: false,
  });
  const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.namespaceURI !== 'http://www.w3.org/2000/svg' || svg.localName !== 'svg') throw new Error('Invalid diagram output');
  const variables: Record<string, string> = {
    bg: palette.background, fg: palette.foreground, muted: palette.mutedForeground,
    line: palette.mutedForeground, surface: palette.card, 'surface-alt': palette.muted,
    border: palette.border, accent: palette.primary, critical: palette.primary,
    font: palette.fontFamily, 'font-mono': palette.fontMono,
  };
  for (const [name, value] of Object.entries(variables)) svg.style.setProperty(`--pele-${name}`, value);
  svg.id = id;
  // The existing portable-font planner reads concrete family declarations.
  // Resolve Pele's font variables before packaging the drawing as an image.
  svg.style.setProperty('font-family', palette.fontFamily);
  for (const element of svg.querySelectorAll<SVGElement>('[style]')) {
    const family = element.style.getPropertyValue('font-family');
    if (family.includes('var(')) element.style.setProperty('font-family', /--_fm|--pele-font-mono/.test(family) ? palette.fontMono : palette.fontFamily);
  }
  const style = parsed.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `#${id}{font-family:${palette.fontFamily}}`;
  svg.appendChild(style);
  const markup = new XMLSerializer().serializeToString(svg);
  return {src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, type: result.mermaidType, width: result.width, height: result.height};
}

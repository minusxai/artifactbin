// Browser engine boundary: imported lazily by Mermaid so prose and server
// rendering do not load Mermaid's parser/layout engines.
import mermaid from 'mermaid';
import { mermaidSourceError } from '@/lib/story-ui/mermaid-source';

/** The document's theme, resolved to hex for Mermaid's colour math, plus the host's type. */
export interface MermaidPalette {
  background: string;
  foreground: string;
  primary: string;
  border: string;
  /** Node fill — the theme's card surface. */
  card: string;
  /** Group/cluster fill — the theme's muted surface. */
  muted: string;
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

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * The document's own rules for the drawing, appended after Mermaid's. Mermaid
 * scopes every rule to the diagram id, so these carry the same prefix and one
 * more class to win: theme variables reach node fills and line colours, but not
 * the edge label's face or its half-transparent ground.
 */
function documentStyles(id: string, palette: MermaidPalette): string {
  return [
    // Edge labels are apparatus: the utility face, small, muted, on an opaque ground so the line never shows through.
    `#${id} .edgeLabels .edgeLabel rect { opacity: 1; fill: ${palette.background}; stroke: none; }`,
    `#${id} .edgeLabels .edgeLabel text, #${id} .edgeLabels .edgeLabel tspan { font-family: ${palette.fontMono}; font-size: 11px; fill: ${palette.mutedForeground}; }`,
    // Hairline edges, like the tile borders around them.
    `#${id} .edgePaths .path, #${id} .flowchart-link { stroke-width: 1.5px; }`,
  ].join('\n');
}

// initialize changes Mermaid's global config. Serialize initialize + render
// so diagrams in different documents/themes cannot borrow each other's config.
let queue: Promise<unknown> = Promise.resolve();
let nextId = 0;

export function renderMermaid(code: string, palette: MermaidPalette): Promise<MermaidImage> {
  const render = async () => {
    const error = mermaidSourceError(code);
    if (error) throw new Error(error);
    mermaid.initialize({
      startOnLoad: false, securityLevel: 'strict', htmlLabels: false,
      maxTextSize: 20_000, maxEdges: 500, suppressErrorRendering: true,
      // Mermaid 12 defaults to its "neo" look, which drops an offset shadow under
      // every node and actor through the theme's dropShadow filter. Document tiles
      // are flat, so the diagram is too: the classic look draws plain fills and hairlines.
      look: 'classic',
      theme: 'base',
      themeVariables: {
        darkMode: palette.dark, background: palette.background,
        fontFamily: palette.fontFamily, fontSize: palette.fontSize,
        // Nodes: the card surface, a hairline border, body text.
        primaryColor: palette.card, mainBkg: palette.card,
        nodeBorder: palette.border, primaryBorderColor: palette.border,
        secondaryColor: palette.muted, secondaryBorderColor: palette.border,
        tertiaryColor: palette.muted, tertiaryBorderColor: palette.border,
        primaryTextColor: palette.foreground, secondaryTextColor: palette.foreground,
        tertiaryTextColor: palette.foreground, textColor: palette.foreground, nodeTextColor: palette.foreground,
        // Edges sit back from the nodes; their labels sit on the page ground.
        lineColor: palette.mutedForeground, arrowheadColor: palette.mutedForeground,
        edgeLabelBackground: palette.background,
        // Groups: the muted surface under the same hairline.
        clusterBkg: palette.muted, clusterBorder: palette.border, titleColor: palette.foreground,
      },
      // Tighter than Mermaid 12's defaults, which pad every node out to 120px and
      // wrap its label at 120px: a tile scales the drawing to fit, so every pixel
      // of box and spacing is a pixel taken from the labels. Nodes hug their text.
      flowchart: { nodeSpacing: 32, rankSpacing: 40, diagramPadding: 4, minNodeWidth: 72, wrappingWidth: 200 },
    });
    const id = `mx-mermaid-${++nextId}`;
    const result = await mermaid.render(id, code);
    const parsed = new DOMParser().parseFromString(result.svg, 'image/svg+xml');
    const svg = parsed.documentElement;
    // Not well-formed XML (a parsererror document): show the engine's output as it came.
    if (svg.namespaceURI !== SVG_NS || svg.localName !== 'svg') {
      return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`, type: result.diagramType };
    }
    const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const dimensions = box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0
      ? { width: box[2], height: box[3] } : {};
    const style = parsed.createElementNS(SVG_NS, 'style');
    style.textContent = documentStyles(id, palette);
    svg.appendChild(style);
    // SVG is displayed as an image, never inserted as active parent DOM.
    // Source remains in the JSX code prop; the diagram inspector edits it.
    const markup = new XMLSerializer().serializeToString(svg);
    return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, type: result.diagramType, ...dimensions };
  };
  const result = queue.then(render);
  queue = result.catch(() => undefined);
  return result;
}

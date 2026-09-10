// Browser engine boundary: imported lazily by Mermaid so prose and server
// rendering do not load Mermaid's parser/layout engines.
import mermaid from 'mermaid';
import { mermaidSourceError } from '@/lib/story-ui/mermaid-source';

export interface MermaidPalette { background: string; foreground: string; primary: string; border: string; dark: boolean }
export interface MermaidImage { src: string; type: string; width?: number; height?: number }

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
      theme: 'base',
      themeVariables: {
        darkMode: palette.dark, background: palette.background,
        primaryColor: palette.background, primaryTextColor: palette.foreground,
        primaryBorderColor: palette.primary, lineColor: palette.foreground,
        secondaryColor: palette.background, tertiaryColor: palette.background,
        textColor: palette.foreground, mainBkg: palette.background,
        nodeBorder: palette.border, fontFamily: 'system-ui, sans-serif',
      },
    });
    const result = await mermaid.render(`mx-mermaid-${++nextId}`, code);
    const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement;
    const box = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    const dimensions = box?.length === 4 && box.every(Number.isFinite) && box[2] > 0 && box[3] > 0
      ? { width: box[2], height: box[3] } : {};
    // SVG is displayed as an image, never inserted as active parent DOM.
    // Source remains in the JSX code prop for future type-specific editors.
    return { src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(result.svg)}`, type: result.diagramType, ...dimensions };
  };
  const result = queue.then(render);
  queue = result.catch(() => undefined);
  return result;
}

/**
 * Which lazily loaded code a document will reach for — read from its parsed
 * body at render time, so both reader paths can name that code in the head
 * instead of discovering it one import at a time: the served document
 * (lib/story/document) from the runtime build's manifest, the app's reader
 * page (server/reader-preloads) from the Vite manifest.
 *
 * The precision matters in both directions. Code a document will not run must
 * never be named — splitting exists so a prose page does not pay for charts or
 * diagram engines — and code it will run must all be named, or the chain of
 * round trips stays.
 */
import type { JsxNode } from '@/lib/jsx';
import { mermaidDiagramKind, mermaidImageKey } from '@/lib/story-ui/mermaid-source';
import type { StoredMermaidImage } from '@/lib/story-runtime/contract';

/** The `viz.kind`s whose branch in QuestionEmbed reaches the lazy chart module. */
const CHART_VIZ_KINDS = new Set(['vega', 'vega-lite', 'recipe']);

export interface LazyCode {
  /** A `<Question>` draws a chart, so the document imports the chart module. */
  chart: boolean;
  /** The Mermaid diagram kinds it draws WITH THE ENGINE (lib/story-ui/mermaid-source), each once, in document order. */
  mermaid: string[];
  /**
   * The stored drawings it shows instead (lib/mermaid-images), in document
   * order: those need no engine, only their image. Absent or empty when none is stored.
   */
  mermaidImages?: string[];
}

/**
 * What a render already holds for its diagrams: the version's stored drawings
 * and the mode it is served in. A diagram with a drawing stored for that mode
 * is drawn from it (components/kit/mermaid), so its kind's engine code is not
 * this document's to preload — unless another diagram of the kind has none.
 */
export interface StoredDrawings { images?: Readonly<Record<string, StoredMermaidImage>>; mode: 'light' | 'dark' }

/**
 * Only `<Question>` imports the chart bundle, and only for the kinds above: a
 * question with no `viz`, or one whose kind is `table` or `single_value`,
 * renders inline and never touches it. Only a `<Mermaid>` with a static code
 * string the kit will draw imports the diagram engine, and then only its kind.
 */
export function lazyCodeOf(nodes: JsxNode[], stored?: StoredDrawings): LazyCode {
  let chart = false;
  const mermaid = new Set<string>();
  const images = new Set<string>();
  const walk = (list: JsxNode[]) => {
    for (const n of list) {
      if (n.type !== 'element') continue;
      if (n.isComponent && n.tag === 'Question') {
        const viz = n.attributes.find((a) => a.name === 'viz')?.value;
        const kind = viz?.static && viz.json && typeof viz.json === 'object' && !Array.isArray(viz.json)
          ? viz.json.kind : null;
        if (typeof kind === 'string' && CHART_VIZ_KINDS.has(kind)) chart = true;
      }
      if (n.isComponent && n.tag === 'Mermaid') {
        const code = n.attributes.find((a) => a.name === 'code')?.value;
        const json = code?.static ? code.json : null;
        const kind = mermaidDiagramKind(json);
        const drawn = kind && typeof json === 'string' && stored?.images ? stored.images[mermaidImageKey(json, stored.mode)] : undefined;
        if (drawn) images.add(drawn.src);
        else if (kind) mermaid.add(kind);
      }
      walk(n.children);
    }
  };
  walk(nodes);
  return { chart, mermaid: [...mermaid], mermaidImages: [...images] };
}

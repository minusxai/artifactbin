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
import { mermaidDiagramKind } from '@/lib/story-ui/mermaid-source';

/** The `viz.kind`s whose branch in QuestionEmbed reaches the lazy chart module. */
const CHART_VIZ_KINDS = new Set(['vega', 'vega-lite', 'recipe']);

export interface LazyCode {
  /** A `<Question>` draws a chart, so the document imports the chart module. */
  chart: boolean;
  /** The Mermaid diagram kinds it draws (lib/story-ui/mermaid-source), each once, in document order. */
  mermaid: string[];
}

/**
 * Only `<Question>` imports the chart bundle, and only for the kinds above: a
 * question with no `viz`, or one whose kind is `table` or `single_value`,
 * renders inline and never touches it. Only a `<Mermaid>` with a static code
 * string the kit will draw imports the diagram engine, and then only its kind.
 */
export function lazyCodeOf(nodes: JsxNode[]): LazyCode {
  let chart = false;
  const mermaid = new Set<string>();
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
        const kind = code?.static ? mermaidDiagramKind(code.json) : null;
        if (kind) mermaid.add(kind);
      }
      walk(n.children);
    }
  };
  walk(nodes);
  return { chart, mermaid: [...mermaid] };
}

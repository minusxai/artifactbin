/**
 * What a NEW VERSION of a document is made of, for whoever has to re-render
 * one that is already on screen.
 *
 * Two callers, one door. The events route builds this for an agent's write and
 * streams it to every open copy; the owner's page builds it for a structural
 * edit it originated itself (delete, insert, a chart's spec) and posts it into
 * the frame — the runtime ships no JSX parser, so nodes have to be made by the
 * sender. Both must describe exactly the tree a reload would produce, which is
 * why this is the same parse → nesting repair → Helmet split the served
 * document uses, and why it lives HERE: `lib/story/document.ts` is the server's
 * builder and imports `path`/`module`, so nothing in it can run in a browser.
 *
 * Pure: source in, parts out, no DOM, no I/O.
 */
import { parseJsx, type JsxNode } from '@/lib/jsx';
import type { Dataflow } from '@/lib/story/dataflow';
import { splitHelmet } from '@/lib/story/helmet';
import { fixHtmlNesting } from '@/lib/story/nesting';

export interface StoryUpdateParts {
  /** The body — what the runtime re-renders. The Helmet is never in it. */
  nodes: JsxNode[];
  /** The author's own `<Helmet>` `<style>`, or null when there is none. */
  authorCss: string | null;
  /**
   * The `<Value>`/`<Query>` declarations themselves. The runtime needs these to
   * re-run a query at all, so a sender pushing a version whose data changed has
   * to carry them — the frame has no parser to recover them from source.
   */
  flow: Dataflow;
  /**
   * A signature of the `<Value>`/`<Query>` declarations, stable over a prose
   * edit and changed by any change to a declaration. It decides whether the
   * sender has to run the document's SQL again: too sensitive and every
   * sentence costs a DuckDB run; not sensitive enough and a reader keeps
   * querying a document that no longer exists. Source offsets are zeroed so
   * text moving ABOVE the Helmet does not count as a change.
   */
  declarations: string;
}

/** Null when the source does not parse — an update that cannot be described is not sent. */
export function storyUpdateParts(source: string): StoryUpdateParts | null {
  const parsed = parseJsx(source);
  if (!parsed.ok) return null;
  const { content, body } = splitHelmet(fixHtmlNesting(parsed.nodes));
  return {
    nodes: body,
    authorCss: content.style ?? null,
    flow: { values: content.values, queries: content.queries, ...(content.mutations.length ? { mutations: content.mutations } : {}) },
    declarations: JSON.stringify({
      values: content.values.map((v) => ({ ...v, start: 0, end: 0 })),
      queries: content.queries.map((q) => ({ ...q, start: 0, end: 0 })),
      mutations: content.mutations.map((m) => ({ ...m, start: 0, end: 0 })),
    }),
  };
}

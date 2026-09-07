/**
 * What a NEW VERSION of a document is made of, for whoever has to re-render
 * one that is already on screen.
 *
 * Two callers, one door. The events route builds this for an agent's write and
 * streams it to every open copy; the owner's page builds it for a structural
 * edit it originated itself (delete, insert, a chart's spec) and posts it into
 * the frame — the runtime ships no JSX parser, so nodes have to be made by the
 * sender. Both must describe exactly the tree a reload would produce, which is
 * why the tree comes from `storyBodyFor` — the ONE parse → nesting repair →
 * Helmet split → asset mapping the served document is built from
 * (lib/story/body) — rather than from a second copy of it here. It lives in
 * this file rather than beside the builder because `lib/story/document.ts`
 * imports `path`/`module`, so nothing in it can run in a browser, and the
 * owner's page builds these parts in one.
 *
 * Pure: source in, parts out, no DOM, no I/O.
 */
import type { JsxNode } from '@/lib/jsx';
import type { Dataflow } from '@/lib/story/dataflow';
import { storyBodyFor } from '@/lib/story/body';
import type { AssetLookup } from '@/lib/story/asset-url';

export interface StoryUpdateParts {
  /** The body — what the runtime re-renders. The Helmet is never in it. */
  nodes: JsxNode[];
  /** The author's own `<Helmet>` `<style>`, or null when there is none. */
  authorCss: string | null;
  /** Script data for the isolated child; null explicitly revokes the previous script. */
  authorScript: string | null;
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

/**
 * Null when the source does not parse — an update that cannot be described is
 * not sent. `assets` is the serve-time asset lookup (lib/story/asset-url): the
 * server passes the rows it holds so a live frame names our copy of an external
 * image exactly as a reload would, and the OWNER'S PAGE passes a predicate,
 * because the editor knows a stored document's URLs were imported at its last
 * write but not what the rows recorded.
 */
export function storyUpdateParts(source: string, assets?: AssetLookup): StoryUpdateParts | null {
  const parts = storyBodyFor(source, assets);
  if (!parts) return null;
  const { content, body } = parts;
  return {
    nodes: body,
    authorCss: content.style ?? null,
    authorScript: content.script ?? null,
    flow: { values: content.values, queries: content.queries, ...(content.mutations.length ? { mutations: content.mutations } : {}) },
    declarations: JSON.stringify({
      values: content.values.map((v) => ({ ...v, start: 0, end: 0 })),
      queries: content.queries.map((q) => ({ ...q, start: 0, end: 0 })),
      mutations: content.mutations.map((m) => ({ ...m, start: 0, end: 0 })),
    }),
  };
}

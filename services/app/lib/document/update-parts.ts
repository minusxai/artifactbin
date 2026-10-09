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
 * (lib/document/body) — rather than from a second copy of it here. It lives in
 * this file rather than beside the builder because the builder (`lib/story/document`)
 * imports `path`/`module`, so nothing in it can run in a browser, and the
 * owner's page builds these parts in one.
 *
 * Pure: source in, parts out, no DOM, no I/O.
 */
import type { JsxNode } from '@/lib/jsx';
import { storyBodyFor, storyBodyOf } from '@/lib/document/body';
import { parseJsxShared } from '@/lib/jsx/parse-shared';
import type { AssetLookup } from '@/lib/document/asset-url';

interface StoryUpdateParts {
  /** The body — what the runtime re-renders. The Helmet is never in it. */
  nodes: JsxNode[];
  /** The author's own `<Helmet>` `<style>`, or null when there is none. */
  authorCss: string | null;
  /** Legacy Helmet script, executed only in an isolated author realm. */
  authorScript: string | null;
  /**
   * A signature of the `<Value>`/`<Query>` declarations, stable over a prose
   * edit and changed by any change to a declaration. It decides whether the
   * sender has to run the document's SQL again: too sensitive and every
   * sentence costs a query run; not sensitive enough and a reader keeps
   * querying a document that no longer exists. Source offsets are zeroed so
   * text moving ABOVE the Helmet does not count as a change.
   */
  declarations: string;
}

/**
 * Null when the source does not parse — an update that cannot be described is
 * not sent. `assets` is the serve-time asset lookup (lib/document/asset-url): the
 * server passes the rows it holds so a live frame names our copy of an external
 * image exactly as a reload would, and the OWNER'S PAGE passes a predicate,
 * because the editor knows a stored document's URLs were imported at its last
 * write but not what the rows recorded.
 */
export function storyUpdateParts(source: string, assets?: AssetLookup): StoryUpdateParts | null {
  return partsOf(storyBodyFor(source, assets));
}

/**
 * The same parts from the page's SHARED parse (lib/jsx/parse-shared): the owner's editor asks for one source's
 * parts from several places at a pause (the draft sender, the frame's reconcile, the declarations check), and the
 * undo history and save diff parse that same source, so it is parsed once. Browser callers only: the tree is
 * shared and read-only (no pass of `storyBodyOf` mutates it).
 */
export function storyUpdatePartsShared(source: string, assets?: AssetLookup): StoryUpdateParts | null {
  const kept = sharedParts.find((entry) => entry.source === source && entry.assets === assets);
  if (kept) return kept.parts;
  const parts = partsOf(storyBodyOf(parseJsxShared(source), assets));
  sharedParts.unshift({ source, assets, parts });
  if (sharedParts.length > 4) sharedParts.length = 4;
  return parts;
}
/** The last few answers: one pause asks for the same source's parts from the sender, the frame and the query check. */
const sharedParts: Array<{ source: string; assets: AssetLookup | undefined; parts: StoryUpdateParts | null }> = [];

function partsOf(parts: ReturnType<typeof storyBodyFor>): StoryUpdateParts | null {
  if (!parts) return null;
  const { content, body } = parts;
  return {
    nodes: body,
    authorCss: content.style ?? null,
    authorScript: content.script ?? null,
    declarations: JSON.stringify({
      imports: content.imports.map((i) => ({ ...i, start: 0, end: 0 })),
      values: content.values.map((v) => ({ ...v, start: 0, end: 0 })),
      queries: content.queries.map((q) => ({ ...q, start: 0, end: 0 })),
      notifications: (content.notifications ?? []).map((n) => ({ ...n, start: 0, end: 0 })),
      mutations: content.mutations.map((m) => ({ ...m, start: 0, end: 0 })),
    }),
  };
}

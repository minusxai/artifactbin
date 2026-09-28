/**
 * THE LINK FOLLOWS THE READER on a compiled page (today's lib/story-runtime/url-values-sync, unchanged):
 * when a `<Value>` the link carries moves, the top-level page rewrites its own address — its `$` params
 * only (lib/story/url-values), every other param and the hash kept, replaced rather than pushed — so the
 * address bar says what the reader narrowed the document to, and a copy of it opens the same document.
 *
 * Bundled alone (scripts/build-islands.mjs STANDALONE_LAZY) and loaded by boot after hydration, off the
 * shared runtime's closure; a value moved before it loaded is written at once. A sandboxed copy whose
 * opaque origin refuses the rewrite keeps its address.
 */
import { readUrlValues, urlValueParams, writeUrlValues } from '@/lib/story/url-values';
import type { DataflowStore } from '@/lib/story-runtime/store';
import { syncValuesToUrl } from '@/lib/story-runtime/url-values-sync';

export function startUrlSync(win: Window, store: DataflowStore): () => void {
  const write = () => {
    const { pathname, search, hash } = win.location;
    try { win.history.replaceState(win.history.state, '', `${pathname}${writeUrlValues(search, store.flow, store.getState().values)}${hash}`); } catch { /* an opaque origin keeps its address */ }
  };
  const params = (values: Record<string, import('@/lib/story/dataflow').Scalar>) => JSON.stringify(urlValueParams(store.flow, values));
  // What the address says now: the declared defaults under the link's own `$` values.
  const linked = { ...Object.fromEntries(store.flow.values.flatMap((v) => (v.kind === 'scalar' ? [[v.name, v.default ?? null]] : []))), ...readUrlValues(win.location.search, store.flow) };
  if (params(store.getState().values) !== params(linked)) write();
  return syncValuesToUrl(store, () => store.flow, { hook: write });
}

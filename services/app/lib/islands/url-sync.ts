/**
 * THE LINK FOLLOWS THE READER on a compiled page: when a `<Value>` the link carries moves, the
 * top-level page rewrites its own address — its `$` params only (lib/dataflow/url-values), every other
 * param and the hash kept, replaced rather than pushed — so the address bar says what the reader
 * narrowed the document to, and a copy of it opens the same document.
 *
 * Two rules, both about not being noisy: the write is DEBOUNCED (a slider is a burst, not a decision),
 * and it is COMPARED against what the link last said — a store notifies for things that are not a value
 * change at all (rows landing, a query going busy), and an address rewritten on each of those is churn
 * a reader can see in their own back button. The flow is read at write time, never captured: an
 * agent's write replaces the declarations under an open document (`store.replaceFlow`), and a Value
 * that version no longer declares must stop appearing in the link.
 *
 * Bundled alone (scripts/build/build-islands.mjs STANDALONE_LAZY) and loaded by boot after hydration, off the
 * shared runtime's closure; a value moved before it loaded is written at once. A sandboxed copy whose
 * opaque origin refuses the rewrite keeps its address.
 *
 * FRAMED on its own origin, the reader's address is the app page's, not this document's: every write also hands
 * `post` the `$` params alone (lib/story-runtime/contract STORY_URL_VALUES_MESSAGE), which boot sends to the page.
 */
import { readUrlValues, urlValueParams, writeUrlValues } from '@/lib/dataflow/url-values';
import type { DataflowStore } from '@/lib/story-runtime/store';

/** ~150ms: long enough to swallow a drag, short enough that a click feels answered. */
const URL_SYNC_DEBOUNCE_MS = 150;

export function startUrlSync(
  win: Window,
  store: Pick<DataflowStore, 'subscribe' | 'getState' | 'flow'>,
  debounceMs: number = URL_SYNC_DEBOUNCE_MS,
  /** The page that frames this document, told what its own link's `$` params should now be (`''` at rest). */
  post?: (values: string) => void,
): () => void {
  const said = () => JSON.stringify(urlValueParams(store.flow, store.getState().values));
  const write = () => {
    const { pathname, search, hash } = win.location;
    const values = store.getState().values;
    try { win.history.replaceState(win.history.state, '', `${pathname}${writeUrlValues(search, store.flow, values)}${hash}`); } catch { /* an opaque origin keeps its address */ }
    post?.(writeUrlValues('', store.flow, values));
  };
  // What the address says now: the declared defaults under the link's own `$` values.
  const linked = { ...Object.fromEntries(store.flow.values.flatMap((v) => (v.kind === 'scalar' ? [[v.name, v.default ?? null]] : []))), ...readUrlValues(win.location.search, store.flow) };
  let last = said();
  if (last !== JSON.stringify(urlValueParams(store.flow, linked))) write();

  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    const next = said();
    if (next === last) return;
    last = next;
    write();
  };
  const stop = store.subscribe(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  });
  return () => {
    if (timer) clearTimeout(timer);
    stop();
  };
}

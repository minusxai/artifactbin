/**
 * THE COMPILED PAGE'S AUTHOR SCRIPT HOST, loaded lazily by `boot` only when the page data island names
 * an author script (IslandPageData.authorScript): today's author-script session
 * (lib/story-runtime/author-script `createAuthorScriptSession`) started against the island store, as
 * lib/story-runtime/entry.tsx starts it against the standalone document's store.
 *
 * The trust boundary is today's, unchanged: the code never runs in this document. The session mounts
 * a hidden `sandbox="allow-scripts"` frame on the fixed HTTP wrapper (`AUTHOR_FRAME_PATH`, its own CSP),
 * and the source crosses as DATA over a transferred MessagePort after the wrapper loads. The frame gets
 * only the bridge's data operations over the store (describe, read, set, declared mutations,
 * subscriptions), restarts when the store's declarations change, and is revoked on dispose.
 *
 * Bundled ALONE (scripts/build/build-islands.mjs STANDALONE_LAZY): no Solid, its shared code copied in, so a
 * page without an author script never pays for it and the rt+boot closure never grows. A document that
 * declares no data has no island store; the realm then gets an empty one, as today's runtime always
 * hands it one.
 */
import { createAuthorScriptSession } from '@/lib/story-runtime/author-script';
import { createDataflowStore, type DataflowStore } from '@/lib/story-runtime/store';

/** Start the version's author script; the returned function revokes its realm (idempotent). */
export function startAuthorHost(source: string, store: DataflowStore | null, doc: Document = document): () => void {
  const own = store ? null : createDataflowStore({ flow: { imports: [], values: [], queries: [], mutations: [] } });
  const session = createAuthorScriptSession(store ?? own!, doc);
  const win = doc.defaultView;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    win?.removeEventListener('pagehide', onPageHide);
    session.dispose();
    own?.dispose();
  };
  // A page leaving for good revokes its realm; one kept in the back/forward cache keeps it (entry.tsx).
  const onPageHide = (event: Event) => { if (!(event as PageTransitionEvent).persisted) stop(); };
  win?.addEventListener('pagehide', onPageHide);
  session.replace(source);
  return stop;
}

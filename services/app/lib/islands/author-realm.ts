/**
 * THE COMPILED PAGE'S AUTHOR REALM, loaded lazily by `boot` only when the page data island names an
 * author script (IslandPageData.authorScript) and the interpreter it runs in (IslandPageData.quickjsWasm):
 * the wasm is fetched once per page from its content-addressed `/islands/` URL (credentials omitted, as
 * the SQLite engine is), compiled once, and each start instantiates its own bounded module and runs the
 * script in a realm over the island store (lib/story-runtime/author-realm) and the story root.
 *
 * The page records the running realm on `<html data-mx-author-realm="<generation>">` — what the browser
 * gates look for — and removes it when the realm ends. Bundled ALONE (scripts/build/build-islands.mjs
 * STANDALONE_LAZY): no Solid, its shared code copied in, so a page without a script never pays for it.
 */
import { compileRealmWasm, newRealmModule, type RealmWasm } from '@/lib/story-runtime/author-realm/module';
import { createAuthorRealm, type AuthorRealm } from '@/lib/story-runtime/author-realm/realm';
import { createDataflowStore, type DataflowStore } from '@/lib/story-runtime/store';
import { STORY_ROOT_SELECTOR } from './contract';

export const AUTHOR_REALM_ATTR = 'data-mx-author-realm';
const compiled = new Map<string, Promise<RealmWasm>>();
let generation = 0;

/** The interpreter's wasm, compiled once per URL for the page's lifetime. */
function realmWasm(url: string, fetchFn: typeof fetch): Promise<RealmWasm> {
  let loading = compiled.get(url);
  if (!loading) {
    loading = fetchFn(url, { credentials: 'omit' }).then(async (response) => {
      if (!response.ok) throw new Error(`the script interpreter did not load (${response.status})`);
      return compileRealmWasm(await response.arrayBuffer());
    });
    loading.catch(() => compiled.delete(url));
    compiled.set(url, loading);
  }
  return loading;
}

/** Start the version's author script; the returned function ends its realm (idempotent). */
export function startAuthorRealm(source: string, store: DataflowStore | null, doc: Document, wasmUrl: string, fetchFn: typeof fetch = fetch): () => void {
  const own = store ? null : createDataflowStore({ flow: { imports: [], values: [], queries: [], mutations: [] } });
  const win = doc.defaultView;
  const mine = String(++generation);
  let realm: AuthorRealm | null = null;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    win?.removeEventListener('pagehide', onPageHide);
    realm?.dispose();
    own?.dispose();
    if (doc.documentElement.getAttribute(AUTHOR_REALM_ATTR) === mine) doc.documentElement.removeAttribute(AUTHOR_REALM_ATTR);
  };
  // A page leaving for good ends its realm; one kept in the back/forward cache keeps it.
  const onPageHide = (event: Event) => { if (!(event as PageTransitionEvent).persisted) stop(); };
  win?.addEventListener('pagehide', onPageHide);
  void realmWasm(wasmUrl, fetchFn).then(newRealmModule).then((module) => {
    if (stopped) return;
    const root = doc.querySelector<HTMLElement>(STORY_ROOT_SELECTOR) ?? doc.body;
    realm = createAuthorRealm({
      module, source, store: store ?? own!, root, doc,
      onError: (message) => { console.error('[artifact script]', message); if (realm?.disposed && doc.documentElement.getAttribute(AUTHOR_REALM_ATTR) === mine) doc.documentElement.removeAttribute(AUTHOR_REALM_ATTR); },
    });
    if (!realm.disposed) doc.documentElement.setAttribute(AUTHOR_REALM_ATTR, mine);
  }).catch((error: unknown) => { console.error('[islands] the author realm did not start', error); });
  return stop;
}

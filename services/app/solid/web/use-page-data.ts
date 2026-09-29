/**
 * The Solid twin of web/use-page-data.ts over the SAME store (web/page-data-store, unchanged).
 *
 * React → Solid mapping, and why each piece moved:
 * - `useSyncExternalStore(store.subscribe, store.revision)` → a signal fed by `store.subscribe`,
 *   and the resource is a memo of (key, revision). `store.resource(key)` answers the same object
 *   while the entry lives, so the memo only notifies when the entry was actually replaced.
 * - `useSyncExternalStore(resource.subscribe, resource.snapshot)` → an effect that subscribes to the
 *   CURRENT resource and re-subscribes when the memo moves; cleanup unsubscribes (the store aborts
 *   a pending load when its last subscriber leaves, exactly as a React unmount does).
 * - the mount effect that loads → an effect over (resource, sessionError). A Solid component runs
 *   once, so a key that depends on a route param must be passed as an accessor.
 * - `useRefreshable` → a window listener for the owner's lifetime.
 *
 * Not ported (probe gap): `NavigationPreloadContext` / `store.adoptPreload` — the React shell starts
 * a page's fetch before its chunk arrives; the Solid shell here has no preload layer yet.
 */
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from 'solid-js';
import { createPageDataStore, type PageDataSnapshot } from '@/web/page-data-store';
import { fetchPageData, REFRESH_EVENT } from '../shared/page-data';
import { useSession } from './session';

export interface PageData<T> {
  data: Accessor<T | null>;
  pending: Accessor<boolean>;
  error: Accessor<Error | null>;
  refresh: (force?: boolean) => Promise<void>;
  seed: (data: T) => void;
  invalidate: () => void;
}

export function usePageData<T>(key: string | Accessor<string>, options?: { seed?: () => T | null; enabled?: Accessor<boolean>; loader?: (signal: AbortSignal) => Promise<T> }): PageData<T> {
  // A partial context (a test double names only `session`) reads as "no store, no error".
  const context = useSession();
  const pages = context.pages ?? null;
  const session = context.session;
  const sessionError: Accessor<Error | null> = context.sessionError ?? (() => null);
  const store = pages ?? (() => { const local = createPageDataStore(); local.setScope('isolated'); return local; })();
  const keyOf = typeof key === 'function' ? key : () => key;
  const [revision, setRevision] = createSignal(store.revision());
  onCleanup(store.subscribe(() => setRevision(store.revision())));
  const resource = createMemo(() => { revision(); return store.resource<T>(keyOf()); });

  // A seed (server-rendered data) stands in for the first load of THIS key only.
  let seededKey: string | null = null;
  const seedNow = (k: string) => { const data = options?.seed?.() ?? null; if (data !== null) { seededKey = k; untrack(resource).seed(data); } };
  seedNow(untrack(keyOf));

  const [state, setState] = createSignal<PageDataSnapshot<T>>(untrack(resource).snapshot());
  createEffect(() => {
    const current = resource();
    setState(current.snapshot());
    onCleanup(current.subscribe(() => setState(current.snapshot())));
  });

  const refresh = (force = false) => {
    const k = untrack(keyOf);
    return untrack(resource).load((signal) => options?.loader ? options.loader(signal) : fetchPageData<T>(k, signal), { force });
  };
  const enabled = () => options?.enabled?.() ?? true;
  createEffect(on([resource, sessionError, enabled], ([, error, on]) => {
    if (!on || error) return;
    if (seededKey === untrack(keyOf)) { seededKey = null; return; }
    void refresh();
  }));
  const onRefresh = () => { if (enabled()) void refresh(true); };
  window.addEventListener(REFRESH_EVENT, onRefresh);
  onCleanup(() => window.removeEventListener(REFRESH_EVENT, onRefresh));

  const snapshot = createMemo<PageDataSnapshot<T>>(() => pages && !session() && sessionError() ? { data: null, pending: false, error: sessionError() } : state());
  return {
    data: () => snapshot().data,
    pending: () => snapshot().pending,
    error: () => snapshot().error,
    refresh,
    seed: (data) => untrack(resource).seed(data),
    invalidate: () => untrack(resource).invalidate(),
  };
}

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
 * Preload: `usePageIntentPreload` starts a page's fetch on hover, focus or press of a link to it, in
 * parallel with the route's lazy chunk. The page's own `usePageData` then JOINS that in-flight request
 * and `adoptPreload` keeps a finished preload from being fetched again.
 */
import { createEffect, createMemo, createSignal, on, onCleanup, untrack, type Accessor } from 'solid-js';
import { createPageDataStore, type PageDataSnapshot } from '@/web/page-data-store';
import { fetchPageData, REFRESH_EVENT } from '../shared/page-data';
import { useSession } from './session';

/**
 * Pages whose data is worth fetching before their chunk lands. Documents are deliberately absent: a
 * client navigation to `/a/:id` ends in a full load of the compiled page (ArtifactAddress), so its
 * JSON would be wasted work; the compiled page owns its own intent rule.
 */
const PRELOADABLE: Array<[RegExp, (m: RegExpExecArray) => string]> = [
  [/^\/$/, () => '/api/page/home?part=core'],
  [/^\/(@[^/]+)\/?$/, (m) => `/api/page/profile/${encodeURIComponent(m[1] ?? '')}`],
];

/** The page-data key for an in-app link href, or null when its page is not preloaded. */
export function preloadKeyFor(href: string, origin = location.origin): string | null {
  let url: URL;
  try { url = new URL(href, origin); } catch { return null; }
  if (url.origin !== origin) return null;
  for (const [pattern, keyOf] of PRELOADABLE) { const m = pattern.exec(url.pathname); if (m) return keyOf(m); }
  return null;
}

/** Call once under the SessionProvider: link intent (mouse hover, keyboard focus, any press) preloads that page's data. */
export function usePageIntentPreload(): void {
  const { pages } = useSession();
  if (!pages) return;
  const onIntent = (event: Event) => {
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
    if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
    if (event.type === 'pointerover' && (event as PointerEvent).pointerType !== 'mouse') return;
    const key = preloadKeyFor(link.href);
    if (key) void pages.preload(key, key, (signal) => fetchPageData(key, signal)).catch(() => { /* the page reports its own error */ });
  };
  const events = ['pointerover', 'focusin', 'pointerdown'] as const;
  for (const name of events) document.addEventListener(name, onIntent, true);
  onCleanup(() => { for (const name of events) document.removeEventListener(name, onIntent, true); });
}

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
    // A link-intent preload of this very key (usePageIntentPreload) is this page's first load.
    if (pages?.adoptPreload(untrack(keyOf), untrack(keyOf))) return;
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

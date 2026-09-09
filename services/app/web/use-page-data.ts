import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPageDataStore, type PageDataSnapshot } from './page-data-store';
import { useSession } from './session';
import { useRefreshable } from '@/lib/navigation';

export async function fetchPageData<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) throw Object.assign(new Error('Could not load page'), { status: response.status });
  return response.json() as Promise<T>;
}

/** Fetched JSON retention only. Callers keep drafts and mounted runtimes local. */
export function usePageData<T>(key: string, options?: { seed?: () => T | null; enabled?: boolean; refreshMounted?: boolean; pauseRevalidation?: boolean; loader?: (signal: AbortSignal) => Promise<T> }) {
  const { pages, session, sessionError } = useSession();
  // Isolated component renders own a local store; the app always provides the
  // shared session store. This is never a module-global anonymous cache.
  const [local] = useState(() => { const store = createPageDataStore(); store.setScope('isolated'); return store; });
  const store = pages ?? local;
  const revision = useSyncExternalStore(store.subscribe, store.revision, store.revision);
  const resource = useMemo(() => store.resource<T>(key), [store, key, revision]);
  const bootstrap = useRef<{ key: string; used: boolean } | null>(null);
  if (!bootstrap.current || bootstrap.current.key !== key) {
    const data = options?.seed?.() ?? null;
    bootstrap.current = { key, used: data !== null };
    if (data !== null) resource.seed(data);
  }
  const state = useSyncExternalStore(resource.subscribe, resource.snapshot, resource.snapshot);
  const loader = useRef(options?.loader); loader.current = options?.loader;
  const refresh = useCallback((force = false) => resource.load((signal) => loader.current ? loader.current(signal) : fetchPageData<T>(key, signal), { force }), [resource, key]);
  useRefreshable(useCallback(() => { if (options?.enabled !== false && options?.refreshMounted !== false) void refresh(true); }, [refresh, options?.enabled, options?.refreshMounted]));
  useEffect(() => {
    if (options?.enabled === false || sessionError) return;
    if (options?.pauseRevalidation && resource.snapshot().data !== null) return;
    if (bootstrap.current?.used) { bootstrap.current.used = false; return; }
    void refresh();
  }, [refresh, options?.enabled, sessionError]);
  useEffect(() => { if (options?.pauseRevalidation && resource.snapshot().data !== null) resource.cancel(); }, [resource, options?.pauseRevalidation]);
  const snapshot: PageDataSnapshot<T> = pages && !session && sessionError ? { data: null, pending: false, error: sessionError } : state;
  return { ...snapshot, refresh, seed: resource.seed, invalidate: resource.invalidate, snapshot: resource.snapshot };
}

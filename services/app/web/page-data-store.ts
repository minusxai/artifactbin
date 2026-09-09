/** Fetched JSON only: never retains mounted runtimes, scripts, editor drafts or credentials. */
export interface PageDataSnapshot<T> { data: T | null; pending: boolean; error: Error | null }
export interface PageDataResource<T> {
  snapshot(): PageDataSnapshot<T>;
  subscribe(listener: () => void): () => void;
  load(loader: (signal: AbortSignal) => Promise<T>, options?: { force?: boolean }): Promise<void>;
  seed(data: T): void;
  invalidate(): void;
  cancel(): void;
}
export interface PageDataStore {
  preload<T>(key: string, navigationId: string, loader: (signal: AbortSignal) => Promise<T>): Promise<void>;
  /** Consume only the preload belonging to this committed navigation. */
  adoptPreload(key: string, navigationId: string): boolean;
  resource<T>(key: string): PageDataResource<T>;
  setScope(scope: string | null): void;
  clear(): void;
  expire(): void;
  subscribe(listener: () => void): () => void;
  revision(): number;
}
/** One session provider owns this bounded cache. Scope changes invalidate every retained reference. */
export function createPageDataStore(options?: { maxEntries?: number; maxBytes?: number }): PageDataStore {
  type Entry = { resource: PageDataResource<unknown>; listeners: Set<() => void>; bytes: number; touched: number; expired: boolean; revoke(): void };
  const entries = new Map<string, Entry>(); const listeners = new Set<() => void>();
  let scope: string | null = null; let revision = 0; let clock = 0; let firstScope = true;
  const waiting = new Set<() => void>();
  const changed = () => { revision++; listeners.forEach((fn) => fn()); };
  const clear = () => { const old = [...entries.values()]; entries.clear(); old.forEach((entry) => entry.revoke()); waiting.forEach((done) => done()); waiting.clear(); changed(); };
  const trim = () => {
    let bytes = [...entries.values()].reduce((n, e) => n + e.bytes, 0);
    for (const [key, entry] of [...entries].sort((a, b) => a[1].touched - b[1].touched)) {
      if (entries.size <= (options?.maxEntries ?? 30) && bytes <= (options?.maxBytes ?? 8 * 1024 * 1024)) break;
      if (entry.listeners.size) continue;
      entries.delete(key); bytes -= entry.bytes; entry.revoke();
    }
  };
  return {
    preload() { throw new Error('M0: implement navigation preload ownership'); },
    adoptPreload() { throw new Error('M0: implement one-use preload adoption'); },
    clear,
    expire() { for (const [key, entry] of entries) { if (entry.listeners.size) entry.expired = true; else { entries.delete(key); entry.revoke(); } } changed(); },
    setScope(next) { if (scope !== next) { scope = next; if (firstScope && next !== null) firstScope = false; else clear(); waiting.forEach((done) => done()); waiting.clear(); } },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    revision: () => revision,
    resource<T>(key: string): PageDataResource<T> {
      const found = entries.get(key); if (found) { found.touched = ++clock; return found.resource as PageDataResource<T>; }
      let state: PageDataSnapshot<T> = { data: null, pending: false, error: null };
      let epoch = 0; let revoked = false; let controller: AbortController | null = null; let pending: Promise<void> | null = null;
      const subscribers = new Set<() => void>();
      const publish = (next: PageDataSnapshot<T>) => {
        state = next; entry.bytes = next.data === null ? 0 : JSON.stringify(next.data).length * 2;
        entry.touched = ++clock; subscribers.forEach((fn) => fn()); trim();
      };
      const invalidate = () => { epoch++; controller?.abort(); pending = null; state = { data: null, pending: false, error: null }; entry.bytes = 0; subscribers.forEach((fn) => fn()); };
      const resource: PageDataResource<T> = {
        snapshot: () => state,
        subscribe(fn) { subscribers.add(fn); return () => { subscribers.delete(fn); if (!subscribers.size && pending) { epoch++; controller?.abort(); pending = null; state = { ...state, pending: false }; } if (!subscribers.size && entry.expired) { if (entries.get(key) === entry) entries.delete(key); entry.revoke(); } trim(); }; },
        seed(data) { if (!revoked) { epoch++; controller?.abort(); pending = null; publish({ data, pending: false, error: null }); } },
        invalidate,
        cancel() { epoch++; controller?.abort(); pending = null; publish({ ...state, pending: false }); },
        load(loader, config) {
          if (revoked) return Promise.resolve();
          if (pending && !config?.force) return pending;
          controller?.abort(); controller = new AbortController(); const signal = controller.signal; const run = ++epoch;
          publish({ ...state, pending: true, error: null });
          let result: Promise<T>;
          try { result = loader(signal); } catch (error) { result = Promise.reject(error); }
          pending = result.then(async (data) => {
            if (scope === null && !revoked) await new Promise<void>((resolve) => {
              const done = () => { waiting.delete(done); signal.removeEventListener('abort', done); resolve(); };
              waiting.add(done); signal.addEventListener('abort', done, { once: true });
              if (signal.aborted) done();
            });
            if (!revoked && epoch === run) publish({ data, pending: false, error: null });
          }, (error: unknown) => {
            if (revoked || epoch !== run) return;
            const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : null;
            publish({ data: status === 401 || status === 403 || status === 404 ? null : state.data, pending: false, error: error instanceof Error ? error : new Error('Page unavailable') });
          }).finally(() => { if (epoch === run) pending = null; });
          return pending;
        },
      };
      const entry: Entry = { resource: resource as PageDataResource<unknown>, listeners: subscribers, bytes: 0, touched: ++clock, expired: false, revoke() { revoked = true; invalidate(); } };
      entries.set(key, entry);
      return resource;
    },
  };
}

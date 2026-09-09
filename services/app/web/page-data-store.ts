/** Fetched JSON only: never retains mounted runtimes, scripts, editor drafts or credentials. */
export interface PageDataSnapshot<T> { data: T | null; pending: boolean; error: Error | null }
export interface PageDataResource<T> {
  snapshot(): PageDataSnapshot<T>;
  subscribe(listener: () => void): () => void;
  load(loader: (signal: AbortSignal) => Promise<T>, options?: { force?: boolean }): Promise<void>;
  seed(data: T): void;
  invalidate(): void;
}
export interface PageDataStore {
  resource<T>(key: string): PageDataResource<T>;
  setScope(scope: string | null): void;
  clear(): void;
}
/** One session provider owns this bounded cache. Scope changes invalidate every retained reference. */
export function createPageDataStore(_options?: { maxEntries?: number; maxBytes?: number }): PageDataStore {
  throw new Error('shared page data: implement');
}

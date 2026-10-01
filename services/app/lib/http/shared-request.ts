/**
 * ONE REQUEST PER RESOURCE, however many components ask — the store behind "a document's members" and
 * friends. Callers asking while a request for the same key is in flight share it; a result younger than
 * `ttl` answers without a request; `force` skips the ttl (an event said the resource changed) but still
 * joins a request already in flight, and `forget`/`prime` are how a write invalidates or seeds it.
 */
interface Entry { value?: unknown; at: number; inflight?: Promise<unknown> }
const entries = new Map<string, Entry>();

export function sharedRequest<T>(key: string, run: () => Promise<T>, options: { ttl?: number; force?: boolean } = {}): Promise<T> {
  const entry = entries.get(key) ?? { at: 0 };
  entries.set(key, entry);
  if (entry.inflight) return entry.inflight as Promise<T>;
  if (!options.force && entry.at && Date.now() - entry.at < (options.ttl ?? 0)) return Promise.resolve(entry.value as T);
  const pending = run().then(value => { entry.value = value; entry.at = Date.now(); return value; }).finally(() => { if (entry.inflight === pending) entry.inflight = undefined; });
  entry.inflight = pending;
  return pending;
}

/** A write changed the resource: the next ask fetches. */
export function forgetShared(key: string): void { const entry = entries.get(key); if (entry) entry.at = 0; }
/** A write returned the resource's new state: later asks within the ttl reuse it. */
export function primeShared(key: string, value: unknown): void { const entry = entries.get(key) ?? { at: 0 }; entry.value = value; entry.at = Date.now(); entries.set(key, entry); }
/** Test isolation: drop every cached and in-flight resource. */
export function resetShared(): void { entries.clear(); }

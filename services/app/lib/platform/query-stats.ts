/**
 * PER-REQUEST DATABASE ACCOUNTING: how many statements a unit of work issued and how long it
 * waited on them. The database adapters (lib/platform/db) record every statement they run while a
 * `measureQueries` scope is active; outside one, recording is a no-op. Held in AsyncLocalStorage,
 * so concurrent requests never share a tally. A nested scope also counts toward its parents.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface QueryStats {
  /** Statements issued, including those inside transactions. */
  count: number;
  /** Milliseconds spent awaiting them (queue and pool waits included). */
  ms: number;
}
interface Scope extends QueryStats { parent: Scope | undefined }

const storage = new AsyncLocalStorage<Scope>();

/** Run `work` and report the statements it issued. */
export async function measureQueries<T>(work: () => Promise<T>): Promise<{ value: T; stats: QueryStats }> {
  const scope: Scope = { count: 0, ms: 0, parent: storage.getStore() };
  const value = await storage.run(scope, work);
  return { value, stats: { count: scope.count, ms: scope.ms } };
}

/** The adapters' hook: time one statement into every active scope. */
export async function recordQuery<T>(run: () => Promise<T>): Promise<T> {
  const scope = storage.getStore();
  if (!scope) return run();
  const started = performance.now();
  try {
    return await run();
  } finally {
    const ms = performance.now() - started;
    for (let s: Scope | undefined = scope; s; s = s.parent) { s.count++; s.ms += ms; }
  }
}

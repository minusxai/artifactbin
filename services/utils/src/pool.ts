/**
 * A serving pg pool's bounds and its idle-error listener, shared by every process that opens one (the app,
 * the proxy, the events service). Plain data and a structural listener: utils never imports `pg` itself.
 *
 * A request that waits 5 s for a connection fails instead of queueing behind the proxy's 30 s deadline, and one
 * runaway statement is cancelled instead of holding its connection for good. Callers set their own `max`.
 */
export const SERVING_POOL = {
  max: 20,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 60_000,
  // A request that dies mid-transaction must not hold its row locks and connection; a statement stuck behind a lock gives up.
  idle_in_transaction_session_timeout: 30_000,
  lock_timeout: 10_000,
} as const;

/**
 * An idle client's error (a database restart or failover) is emitted on the pool; with no listener Node
 * throws it and the process exits. The pool has already discarded that client, so logging is enough.
 */
export function withPoolErrors<P extends { on(event: 'error', cb: (error: Error) => void): unknown }>(pool: P): P {
  pool.on('error', (error) => console.error('[db] idle connection lost:', error.message));
  return pool;
}

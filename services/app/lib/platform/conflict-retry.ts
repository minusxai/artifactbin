/**
 * THE DEADLOCK AND SERIALIZATION SAFETY NET. Writers lock rows in one documented order (lib/artifact-access
 * locks.ts) on the normal path, but not every writer in the codebase can follow it (a group's deletion locks the
 * group before the artifacts that share with it; erasing a test user locks the account first). When two collide,
 * Postgres aborts one transaction with 40P01 (deadlock) or 40001 (serialization failure): nothing of it commits, so
 * no write can land under stale authority. This retries the WHOLE transaction (never a statement), a bounded number
 * of times with jittered backoff, and then refuses with a retryable TransactionConflict.
 *
 * Only safe around work whose effects all live inside the transaction (or are idempotent): a retry re-runs it from
 * the start. Durable receipts are claimed outside it, so a retried write still applies at most once.
 */
const CONFLICT_CODES = new Set(['40P01', '40001']);

/** The transaction kept meeting concurrent writers: nothing was written; the same request may simply be retried. */
export class TransactionConflict extends Error {
  readonly code = 'transaction_conflict';
  constructor(readonly cause: unknown) { super('the write met concurrent writers and was not applied; retry'); }
}

/** Whether `error` is Postgres aborting the transaction for a deadlock or a serialization failure. */
export function isTransactionConflict(error: unknown): boolean {
  for (let e = error as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && depth < 4; e = e.cause as typeof e, depth++) {
    if (typeof e.code === 'string' && CONFLICT_CODES.has(e.code)) return true;
  }
  return false;
}

export interface ConflictRetry { attempts?: number; baseMs?: number; maxMs?: number }

/** Run `transaction` (one whole transaction per call) until it commits, retrying deadlocks and serialization failures. */
export async function retryOnConflict<T>(transaction: (attempt: number) => Promise<T>, options: ConflictRetry = {}): Promise<T> {
  const attempts = options.attempts ?? 4, base = options.baseMs ?? 15, max = options.maxMs ?? 250;
  for (let attempt = 0; ; attempt++) {
    try { return await transaction(attempt); } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt + 1 >= attempts) throw new TransactionConflict(error);
      // Jittered exponential backoff: the colliding writer usually finishes first.
      const wait = Math.min(max, base * 2 ** attempt) * (0.5 + Math.random());
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
}

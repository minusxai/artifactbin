/**
 * Postgres side of Idempotency-Key (rules: src/server/idempotency.ts). Every
 * call takes the caller's transaction, so a key is recorded with its write or
 * not at all. Callers hold the page's header lock, which serializes requests
 * that share a key.
 */
import type { SqlClient } from "./sql.ts";
import {
  decideIdempotency,
  idempotencyCutoff,
  type IdempotencyDecision,
} from "../server/idempotency.ts";

export interface IdempotencyScope {
  fileId: string;
  actor: string;
  key: string;
}

/** Replay or run fresh; another body under a live key throws 422. */
export async function checkIdempotency(
  client: SqlClient,
  scope: IdempotencyScope,
  fingerprint: string,
  now: number,
): Promise<IdempotencyDecision> {
  const row = (
    await client.query(
      "SELECT fingerprint,status,response,created_at FROM idempotency_keys WHERE file_id=$1 AND actor=$2 AND key=$3",
      [scope.fileId, scope.actor, scope.key],
    )
  ).rows[0];
  return decideIdempotency(
    row
      ? {
          fingerprint: String(row.fingerprint),
          status: Number(row.status),
          body: row.response,
          createdAt: Number(row.created_at),
        }
      : null,
    fingerprint,
    now,
  );
}

/**
 * Store a first response (replacing an expired one under the same key) and
 * sweep a bounded batch of expired keys without waiting on other writers.
 */
export async function recordIdempotency(
  client: SqlClient,
  scope: IdempotencyScope,
  fingerprint: string,
  response: { status: number; body: unknown },
  now: number,
): Promise<void> {
  await client.query(
    "INSERT INTO idempotency_keys(file_id,actor,key,fingerprint,status,response,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT (file_id,actor,key) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,status=EXCLUDED.status,response=EXCLUDED.response,created_at=EXCLUDED.created_at",
    [scope.fileId, scope.actor, scope.key, fingerprint, response.status, JSON.stringify(response.body), now],
  );
  await client.query(
    "DELETE FROM idempotency_keys WHERE ctid IN (SELECT ctid FROM idempotency_keys WHERE created_at < $1 LIMIT 100 FOR UPDATE SKIP LOCKED)",
    [idempotencyCutoff(now)],
  );
}

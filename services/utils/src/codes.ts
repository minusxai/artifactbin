import { createHash, timingSafeEqual } from 'node:crypto';
import type { CodeStore, ClaimResult, Queryable } from '@artifactbin/contracts';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** It goes into the SQL text, so only a plain lowercase identifier is admitted. */
function identifier(value: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`${what} must be a plain lowercase identifier, got "${value}"`);
  return value;
}

/**
 * ONE store for every one-time secret: hashed, single-use, attempts capped. Product-blind — it knows
 * kind / code_hash / subject / payload / attempts / expires_at and nothing else. Each owner binds it to
 * its own table (the app's `codes`, the proxy's `codes` in its schema).
 *
 * Two lookup modes, and the difference is irreducible:
 *  - by HASH (claimByHash): the secret is high-entropy, so the hash IS the key and guessing is not a
 *    threat. One atomic `DELETE … RETURNING` is the single-use guarantee — two concurrent claims of one
 *    code cannot both find the row. Always consumed once found, even when expired, so replay stays closed.
 *  - by SUBJECT (claimBySubject): the secret is guessable, so the row is found by what it is bound to and
 *    every wrong guess burns a metered attempt. Reasons, not a boolean: the caller tells expired apart
 *    from wrong apart from spent.
 */
export function createCodeStore(db: Queryable, o: { schema?: string; table?: string } = {}): CodeStore {
  const table = o.table ? identifier(o.table, 'table') : 'codes';
  const t = `${o.schema ? `${identifier(o.schema, 'schema')}.` : ''}${table}`;

  return {
    async issue(i): Promise<void> {
      const now = i.now ?? Date.now();
      // Hygiene rides the write path: each issue sweeps its own kind's corpses, so no background job.
      await db.query(`DELETE FROM ${t} WHERE kind = $1 AND expires_at < $2`, [i.kind, new Date(now).toISOString()]);
      const params = [i.kind, sha256(i.secret), i.subject ?? null, JSON.stringify(i.payload ?? {}), new Date(now + i.ttlMs).toISOString()];
      // A bound code supersedes: one live row per (kind, subject), attempts reset. DELETE+INSERT, not
      // ON CONFLICT — the owner's table may carry no (kind, subject) unique index, and Postgres refuses
      // an arbiter it cannot find even when nothing conflicts.
      if (i.subject != null) await db.query(`DELETE FROM ${t} WHERE kind = $1 AND subject = $2`, [i.kind, i.subject]);
      await db.query(
        `INSERT INTO ${t} (kind, code_hash, subject, payload, attempts, expires_at, created_at)
         VALUES ($1, $2, $3, $4, 0, $5, now())`,
        params,
      );
    },

    async claimByHash(i): Promise<Record<string, unknown> | null> {
      const now = i.now ?? Date.now();
      const row = (await db.query<{ payload: Record<string, unknown>; expires_at: string }>(
        `DELETE FROM ${t} WHERE kind = $1 AND code_hash = $2 RETURNING payload, expires_at`,
        [i.kind, sha256(i.code)],
      )).rows[0];
      if (!row) return null;
      if (now > new Date(row.expires_at).getTime()) return null;
      return row.payload;
    },

    async claimBySubject(i): Promise<ClaimResult> {
      const now = i.now ?? Date.now();
      const row = (await db.query<{ code_hash: string; payload: Record<string, unknown>; attempts: number; expires_at: string }>(
        `SELECT code_hash, payload, attempts, expires_at FROM ${t} WHERE kind = $1 AND subject = $2`,
        [i.kind, i.subject],
      )).rows[0];
      if (!row) return { ok: false, reason: 'unknown' };
      if (now >= new Date(row.expires_at).getTime()) {
        await db.query(`DELETE FROM ${t} WHERE kind = $1 AND subject = $2`, [i.kind, i.subject]);
        return { ok: false, reason: 'expired' };
      }
      if (row.attempts >= i.maxAttempts) return { ok: false, reason: 'exhausted' };
      // Constant-time compare: both sides are fixed-length sha256 hex, so a length mismatch is
      // impossible and timingSafeEqual cannot throw here.
      const presented = Buffer.from(sha256(i.code), 'hex');
      const stored = Buffer.from(row.code_hash, 'hex');
      if (presented.length !== stored.length || !timingSafeEqual(presented, stored)) {
        await db.query(`UPDATE ${t} SET attempts = attempts + 1 WHERE kind = $1 AND subject = $2`, [i.kind, i.subject]);
        return { ok: false, reason: 'mismatch' };
      }
      // Correct — strictly single-use, spent whatever the caller does next.
      await db.query(`DELETE FROM ${t} WHERE kind = $1 AND subject = $2`, [i.kind, i.subject]);
      return { ok: true, payload: row.payload };
    },

    async peekByHash(i): Promise<Record<string, unknown> | null> {
      const now = i.now ?? Date.now();
      const row = (await db.query<{ payload: Record<string, unknown>; expires_at: string }>(
        `SELECT payload, expires_at FROM ${t} WHERE kind = $1 AND code_hash = $2`,
        [i.kind, sha256(i.code)],
      )).rows[0];
      if (!row || now > new Date(row.expires_at).getTime()) return null;
      return row.payload;
    },
  };
}

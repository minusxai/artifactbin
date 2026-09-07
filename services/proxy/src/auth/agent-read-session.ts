import type {Queryable} from '@artifactbin/contracts';
import {createHash, randomBytes} from 'node:crypto';

/** The signed agent cookie carries a per-browser nonce, not just token IDs.
 * Full and read purposes have separate hashed records. Token liveness/ACLs
 * remain the token reader's responsibility on every resolved request. */
export function createAgentReadSessions(db: Queryable, schema = 'auth') {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('agent-read-session: invalid schema');
  const table = `${schema}.credentials`;
  const valid = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s);
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  return {
    async issue(sessionId: string, tokenId: string): Promise<{token: string; expiresAt: Date}> {
      if (!valid(sessionId) || !tokenId) throw new Error('Invalid browser session');
      const token = randomBytes(32).toString('base64url');
      const result = await db.query<{expires_at: Date}>(`WITH browser AS (
        INSERT INTO ${table}(kind,credential_hash,subject_id,expires_at)
        VALUES ('agent-browser',$1,$2,now()+interval '30 days') RETURNING expires_at
      ) INSERT INTO ${table}(kind,credential_hash,subject_id,group_id,expires_at)
        SELECT 'read-agent',$3,$2,$1,expires_at FROM browser RETURNING expires_at`, [hash(sessionId), tokenId, hash(token)]);
      return {token, expiresAt: new Date(result.rows[0].expires_at)};
    },
    async resolve(token: string): Promise<string | null> {
      if (!valid(token)) return null;
      const result = await db.query<{subject_id: string}>(`SELECT r.subject_id FROM ${table} r
        JOIN ${table} b ON b.kind='agent-browser' AND b.credential_hash=r.group_id AND b.subject_id=r.subject_id
        WHERE r.kind='read-agent' AND r.credential_hash=$1 AND r.deleted_at IS NULL AND r.consumed_at IS NULL AND r.expires_at>now()
          AND b.deleted_at IS NULL AND b.consumed_at IS NULL AND b.expires_at>now()`, [hash(token)]);
      return result.rows[0]?.subject_id ?? null;
    },
    async live(sessionId: string, tokenId: string): Promise<boolean> {
      if (!valid(sessionId)) return false;
      return (await db.query(`SELECT 1 FROM ${table} WHERE kind='agent-browser' AND credential_hash=$1 AND subject_id=$2
        AND deleted_at IS NULL AND consumed_at IS NULL AND expires_at>now()`, [hash(sessionId), tokenId])).rows.length === 1;
    },
    async revoke(sessionId: string): Promise<void> {
      if (valid(sessionId)) await db.query(`UPDATE ${table} SET deleted_at=now() WHERE kind='agent-browser' AND credential_hash=$1 AND deleted_at IS NULL`, [hash(sessionId)]);
    },
  };
}

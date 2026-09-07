/** Read handles are random capabilities, never full-session tokens. Resolution
 * joins the live identity session on every request; revocation is not cached. */
import type { Queryable } from '@artifactbin/contracts';
import { createHash, randomBytes } from 'node:crypto';

/** Server-only ACL claims. Verified email resolves invitations before the
 * new user's first trusted workspace request creates their app profile. */
export interface ReadIdentity { userId: string; email?: string }
export interface ReadSessions {
  issue(sessionId: string): Promise<{ token: string; expiresAt: Date } | null>;
  resolve(token: string): Promise<ReadIdentity | null>;
}

export function createReadSessions(db: Queryable, schema = 'auth'): ReadSessions {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('read-session: invalid schema');
  const hash = (token: string) => createHash('sha256').update(token).digest('hex');
  return {
    async issue(sessionId) {
      const token = randomBytes(32).toString('base64url');
      // INSERT…SELECT binds issuance to an existing, unexpired session in one
      // statement. A concurrent revocation still makes resolution fail closed.
      const result = await db.query<{ expires_at: Date }>(`
        INSERT INTO ${schema}.credentials
          (kind, credential_hash, subject_id, group_id, expires_at)
        SELECT 'read-session', $1, "userId", id, "expiresAt"
        FROM ${schema}.session WHERE id=$2 AND "expiresAt">now()
        RETURNING expires_at`, [hash(token), sessionId]);
      return result.rows[0] ? { token, expiresAt: new Date(result.rows[0].expires_at) } : null;
    },
    async resolve(token) {
      if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const result = await db.query<{ userId: string; email: string | null }>(`
        SELECT s."userId", CASE WHEN u."emailVerified" THEN u.email ELSE NULL END AS email FROM ${schema}.credentials c
        JOIN ${schema}.session s ON s.id=c.group_id AND s."userId"=c.subject_id
        JOIN ${schema}."user" u ON u.id=s."userId"
        WHERE c.kind='read-session' AND c.credential_hash=$1
          AND c.deleted_at IS NULL AND c.consumed_at IS NULL
          AND c.expires_at>now() AND s."expiresAt">now()`, [hash(token)]);
      const row = result.rows[0];
      return row ? {userId: row.userId, ...(row.email ? {email: row.email} : {})} : null;
    },
  };
}

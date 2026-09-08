import type {Queryable} from '@artifactbin/contracts';
import {createHash} from 'node:crypto';

/** The signed agent cookie carries a per-browser nonce, not just token IDs.
 * Its hashed database row permits immediate per-browser revocation. Token liveness/ACLs
 * remain the token reader's responsibility on every resolved request. */
export function createAgentBrowserSessions(db: Queryable, schema = 'auth') {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('agent-browser-session: invalid schema');
  const table = `${schema}.credentials`;
  const valid = (s: string) => /^[A-Za-z0-9_-]{43}$/.test(s);
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  return {
    async register(sessionId:string,tokenId:string):Promise<void> {
      if(!valid(sessionId)||!tokenId)throw new Error('Invalid browser session');
      await db.query(`INSERT INTO ${table}(kind,credential_hash,subject_id,expires_at) VALUES ('agent-browser',$1,$2,now()+interval '30 days')`,[hash(sessionId),tokenId]);
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

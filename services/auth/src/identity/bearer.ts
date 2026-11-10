/**
 * THE BEARER READ: one statement per presented credential, no cache. It joins the app-owned `tokens` row
 * (SELECT only), the OAuth family fence over this service's `credentials`, and the account's identity in
 * Better Auth's `user`. Every request reads the database, so a revocation committed by any writer on any
 * connection refuses the very next request; a failed statement throws and the caller answers 503.
 *
 *   SELECT token, fence, identity
 *     FROM <app>.tokens t
 *     LEFT JOIN LATERAL (the first live family membership of t, LIMIT 1) fence ON true
 *     LEFT JOIN <auth>."user" u ON u.id = t.user_id
 *    WHERE t.token_hash = $1 AND live(t) AND (t is not OAuth OR fence found)
 *
 * The fence is the same predicate as the OAuth store's `accessLive`: a retained refresh-token member whose
 * family has no tombstone, and no sibling in that family is revoked or points at a missing or deleted token.
 * The lateral form keeps the planner on `idx_auth_credentials_access` (an EXISTS inside an OR lets it hash
 * every live family); `kind` is a literal so the partial index matches.
 */
import type { Queryable, TokenReader, TokenRecord } from '@artifactbin/contracts';
import { TOKEN_RE, hashToken } from '@artifactbin/utils';

export interface BearerReaderOptions {
  db: Queryable;
  /** AUTH__SCHEMA: where `credentials` and Better Auth's `user` live. Interpolated — a plain identifier. */
  authSchema?: string;
  /** APP__SCHEMA: where the app-owned `tokens` lives; absent means the connection's default schema. */
  appSchema?: string;
  /** The owning service's own bearer admission policy (the app's account kinds), applied after the read. */
  admitBearer?: (token: TokenRecord) => Promise<boolean>;
}

interface BearerRow { id: string; user_id: string | null; audience: string | null; scope: string | null; email: string | null; email_verified: boolean | null }

export function createBearerReader(o: BearerReaderOptions): TokenReader {
  const auth = identifier(o.authSchema ?? 'auth', 'auth schema');
  const tokens = `${o.appSchema ? `${identifier(o.appSchema, 'app schema')}.` : ''}tokens`;
  const sql = (key: 'token_hash' | 'id') => `SELECT t.id, t.user_id, t.audience, t.scope, u.email, u."emailVerified" AS email_verified
    FROM ${tokens} t
    LEFT JOIN LATERAL (
      SELECT 1 AS live FROM ${auth}.credentials member
      JOIN ${auth}.credentials family ON family.kind='refresh_family' AND family.credential_hash=member.group_id AND family.deleted_at IS NULL
      WHERE COALESCE(t.audience,'')<>'' AND member.kind='refresh_token' AND member.payload->>'access_token_id'=t.id
        AND NOT EXISTS (
          SELECT 1 FROM ${auth}.credentials sibling LEFT JOIN ${tokens} access ON access.id=sibling.payload->>'access_token_id'
          WHERE sibling.kind='refresh_token' AND sibling.group_id=member.group_id
            AND (sibling.deleted_at IS NOT NULL OR access.id IS NULL OR access.deleted_at IS NOT NULL))
      LIMIT 1
    ) fence ON true
    LEFT JOIN ${auth}."user" u ON u.id=t.user_id
    WHERE t.${key}=$1 AND t.deleted_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>now())
      AND (COALESCE(t.audience,'')='' OR fence.live IS NOT NULL)`;
  const byHash = sql('token_hash'), byId = sql('id');
  const read = async (statement: string, key: string): Promise<TokenRecord | null> => {
      const row = (await o.db.query<BearerRow>(statement, [key])).rows[0];
      if (!row) return null;
      const token: TokenRecord = {
        id: row.id,
        userId: row.user_id ?? null,
        ...(row.audience ? { audience: row.audience } : {}),
        ...(row.scope ? { scope: row.scope } : {}),
        ...(row.email !== null && row.email !== undefined ? { email: row.email, emailVerified: row.email_verified === true } : {}),
      };
      return !o.admitBearer || await o.admitBearer(token) ? token : null;
  };
  return {
    async byToken(presented) {
      // The shape check comes FIRST: a guess never reaches the hash or the database.
      if (!TOKEN_RE.test(presented)) return null;
      return read(byHash, hashToken(presented));
    },
    async byId(id) {
      return id ? read(byId, id) : null;
    },
  };
}

/** It goes into the SQL text, so only a plain lowercase identifier is admitted. */
function identifier(value: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`${what} must be a plain lowercase identifier, got "${value}"`);
  return value;
}

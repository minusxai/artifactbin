/**
 * THE BEARER READ: one statement per presented credential, no cache. It joins the identity module's `tokens` row
 * (base table, in the auth schema beside this service's `credentials`), the OAuth family fence over `credentials`,
 * and the account's identity in Better Auth's `user`. Every request reads the database, so a revocation committed by any writer on any
 * connection refuses the very next request; a failed statement throws and the caller answers 503.
 *
 *   SELECT token, fence, identity
 *     FROM <auth>.tokens t
 *     LEFT JOIN LATERAL (the first live family membership of t, LIMIT 1) fence ON true
 *     LEFT JOIN <auth>."user" u ON u.id = t.user_id
 *    WHERE t.token_hash = $1 AND live(t) AND (t is not OAuth OR fence found)
 *
 * The fence is the same predicate as the OAuth store's `accessLive`: a retained refresh-token member whose
 * family has no tombstone, no sibling in that family is revoked or points at a missing or deleted token, and, for a
 * family a first-party client's sign-in started (`sessionBoundSql`), the browser session that approved it is live.
 * The lateral form keeps the planner on `idx_auth_credentials_access` (an EXISTS inside an OR lets it hash
 * every live family); `kind` is a literal so the partial index matches.
 */
import type { Queryable, TokenReader, TokenRecord } from '@artifactbin/contracts';
import { TOKEN_RE, hashToken } from '@artifactbin/utils';

export interface BearerReaderOptions {
  db: Queryable;
  /** AUTH__SCHEMA: where `tokens`, `credentials` and Better Auth's `user` live. Interpolated — a plain identifier. */
  authSchema?: string;
  /** The owning service's own bearer admission policy (the app's account kinds), applied after the read. */
  admitBearer?: (token: TokenRecord) => Promise<boolean>;
}

interface BearerRow { id: string; user_id: string | null; audience: string | null; scope: string | null; expires_at: string | Date | null; email: string | null; email_verified: boolean | null }

/**
 * A FAMILY BOUND TO A BROWSER SESSION: a first-party client's grant (IDENTITY__OAUTH_CLIENTS `first_party`) records
 * the browser session that started it on its family row (`payload.session_id`), and lives only while that session is
 * live (Better Auth's `session`, unexpired; signing out deletes it). Any other family carries none and is unaffected.
 * `family` is the alias of the `refresh_family` row; `auth` the auth schema. One spelling, for the bearer read, the
 * `tokens` view and the OAuth store's `accessLive`. `sessions: false` (no Better Auth table yet, the view's case): a bound
 * family is never live.
 */
export function sessionBoundSql(auth: string, family: string, sessions = true): string {
  const unbound = `${family}.payload->>'session_id' IS NULL`;
  return sessions ? `(${unbound} OR EXISTS (SELECT 1 FROM ${auth}.session bound WHERE bound.id=${family}.payload->>'session_id' AND bound."expiresAt">now()))` : `(${unbound})`;
}

/**
 * THE BEARER READ'S LIVENESS, as SQL over a `tokens` row aliased `t`: the lateral `fence` join and the predicate
 * that reads it (row not revoked, not expired, an OAuth token only with a live family). One spelling, used by
 * `createBearerReader` below and by the `tokens` read view's `live` (../identity-store/views), so the two cannot disagree. `auth` and
 * `tokens` are interpolated: the auth schema and the (possibly schema-qualified) tokens table.
 */
export function bearerLiveSql(o: { auth: string; tokens: string; sessions?: boolean }): { fence: string; live: string; exists: string } {
  const { auth, tokens } = o;
  const family = `FROM ${auth}.credentials member
      JOIN ${auth}.credentials family ON family.kind='refresh_family' AND family.credential_hash=member.group_id AND family.deleted_at IS NULL
      WHERE COALESCE(t.audience,'')<>'' AND member.kind='refresh_token' AND member.payload->>'access_token_id'=t.id
        AND ${sessionBoundSql(auth, 'family', o.sessions !== false)}
        AND NOT EXISTS (
          SELECT 1 FROM ${auth}.credentials sibling LEFT JOIN ${tokens} access ON access.id=sibling.payload->>'access_token_id'
          WHERE sibling.kind='refresh_token' AND sibling.group_id=member.group_id
            AND (sibling.deleted_at IS NOT NULL OR access.id IS NULL OR access.deleted_at IS NOT NULL))`;
  const rowLive = `t.deleted_at IS NULL AND (t.expires_at IS NULL OR t.expires_at>now())`;
  return {
    fence: `LEFT JOIN LATERAL (SELECT 1 AS live ${family} LIMIT 1) fence ON true`,
    live: `${rowLive}
      AND (COALESCE(t.audience,'')='' OR fence.live IS NOT NULL)`,
    // The same predicate with the fence as a subquery, for a reader whose FROM must stay the one table (a view).
    exists: `(${rowLive} AND (COALESCE(t.audience,'')='' OR EXISTS (SELECT 1 ${family})))`,
  };
}

export function createBearerReader(o: BearerReaderOptions): TokenReader {
  const auth = identifier(o.authSchema ?? 'auth', 'auth schema');
  const tokens = `${auth}.tokens`;
  const { fence, live } = bearerLiveSql({ auth, tokens });
  const byHash = `SELECT t.id, t.user_id, t.audience, t.scope, t.expires_at, u.email, u."emailVerified" AS email_verified
    FROM ${tokens} t
    ${fence}
    LEFT JOIN ${auth}."user" u ON u.id=t.user_id
    WHERE t.token_hash=$1 AND ${live}`;
  const read = async (statement: string, key: string): Promise<TokenRecord | null> => {
      const row = (await o.db.query<BearerRow>(statement, [key])).rows[0];
      if (!row) return null;
      const token: TokenRecord = {
        id: row.id,
        userId: row.user_id ?? null,
        ...(row.audience ? { audience: row.audience } : {}),
        ...(row.scope ? { scope: row.scope } : {}),
        ...(row.expires_at ? { expiresAt: new Date(row.expires_at).toISOString() } : {}),
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
  };
}

/** It goes into the SQL text, so only a plain lowercase identifier is admitted. */
function identifier(value: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`${what} must be a plain lowercase identifier, got "${value}"`);
  return value;
}

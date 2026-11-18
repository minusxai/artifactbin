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
 *    LEFT JOIN LATERAL (a run sign-in's live parent credential, LIMIT 1) run ON t.issued_by IS NOT NULL
 *    WHERE t.token_hash = $1 AND live(t) AND (a run sign-in ? run found : t is not OAuth OR fence found)
 *
 * The fence is the same predicate as the OAuth store's `accessLive`: a retained refresh-token member whose
 * family has no tombstone, no sibling in that family is revoked or points at a missing or deleted token, and, for a
 * family a first-party client's sign-in started (`sessionBoundSql`), the browser session that approved it is live.
 * The lateral form keeps the planner on `idx_auth_credentials_access` (an EXISTS inside an OR lets it hash
 * every live family); `kind` is a literal so the partial index matches.
 *
 * A RUN SIGN-IN (a token with `issued_by`, a configured service's id: contracts `RUN_SIGN_IN_PATH`) has no family. It
 * is live instead through its `run_sign_in` credential row (keyed by the token's id), and only while the parent
 * credential named there is: a live browser session of the same person, or a live token of theirs that is not itself a
 * run sign-in. A second lateral (`run`) reads it by primary key. Every other token has `issued_by` null and keeps the
 * rule above unchanged.
 */
import type { Queryable, TokenReader, TokenRecord } from '@artifactbin/contracts';
import { TOKEN_RE, hashToken, plainIdentifier } from '@artifactbin/utils';

export interface BearerReaderOptions {
  db: Queryable;
  /** AUTH__SCHEMA: where `tokens`, `credentials` and Better Auth's `user` live. Interpolated — a plain identifier. */
  authSchema?: string;
  /** The owning service's own bearer admission policy (the app's account kinds), applied after the read. */
  admitBearer?: (token: TokenRecord) => Promise<boolean>;
}

interface BearerRow { id: string; user_id: string | null; audience: string | null; scope: string | null; expires_at: string | Date | null; issued_by: string | null; email: string | null; email_verified: boolean | null }

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
  const sessions = o.sessions !== false;
  /** The family fence over the `tokens` row aliased `a` (`t`, or a run sign-in's parent `p`). */
  const family = (a: string, member = 'member', family = 'family', sibling = 'sibling', access = 'access') => `FROM ${auth}.credentials ${member}
      JOIN ${auth}.credentials ${family} ON ${family}.kind='refresh_family' AND ${family}.credential_hash=${member}.group_id AND ${family}.deleted_at IS NULL
      WHERE COALESCE(${a}.audience,'')<>'' AND ${member}.kind='refresh_token' AND ${member}.payload->>'access_token_id'=${a}.id
        AND ${sessionBoundSql(auth, family, sessions)}
        AND NOT EXISTS (
          SELECT 1 FROM ${auth}.credentials ${sibling} LEFT JOIN ${tokens} ${access} ON ${access}.id=${sibling}.payload->>'access_token_id'
          WHERE ${sibling}.kind='refresh_token' AND ${sibling}.group_id=${member}.group_id
            AND (${sibling}.deleted_at IS NOT NULL OR ${access}.id IS NULL OR ${access}.deleted_at IS NOT NULL))`;
  const rowLiveOf = (a: string) => `${a}.deleted_at IS NULL AND (${a}.expires_at IS NULL OR ${a}.expires_at>now())`;
  const rowLive = rowLiveOf('t');
  // A run sign-in's credential row, live while its parent is: the person's session, or a token of theirs that is not
  // itself a run sign-in, by that token's own rule (row and family).
  const run = `FROM ${auth}.credentials run WHERE run.kind='run_sign_in' AND run.credential_hash=t.id AND run.deleted_at IS NULL AND run.subject_id=t.user_id
      AND ((run.payload->>'parent_kind'='session' AND ${sessions ? `EXISTS (SELECT 1 FROM ${auth}.session ps WHERE ps.id=run.payload->>'parent_id' AND ps."userId"=t.user_id AND ps."expiresAt">now())` : 'FALSE'})
        OR (run.payload->>'parent_kind'='token' AND EXISTS (SELECT 1 FROM ${tokens} p WHERE p.id=run.payload->>'parent_id' AND p.user_id=t.user_id AND p.issued_by IS NULL AND ${rowLiveOf('p')}
          AND (COALESCE(p.audience,'')='' OR EXISTS (SELECT 1 ${family('p', 'pmember', 'pfamily', 'psibling', 'paccess')})))))`;
  return {
    fence: `LEFT JOIN LATERAL (SELECT 1 AS live ${family('t')} LIMIT 1) fence ON true
    LEFT JOIN LATERAL (SELECT 1 AS live ${run} LIMIT 1) run ON t.issued_by IS NOT NULL`,
    live: `${rowLive}
      AND (CASE WHEN t.issued_by IS NULL THEN (COALESCE(t.audience,'')='' OR fence.live IS NOT NULL) ELSE run.live IS NOT NULL END)`,
    // The same predicate with the fences as subqueries, for a reader whose FROM must stay the one table (a view).
    exists: `(${rowLive} AND (CASE WHEN t.issued_by IS NULL THEN (COALESCE(t.audience,'')='' OR EXISTS (SELECT 1 ${family('t')})) ELSE EXISTS (SELECT 1 ${run}) END))`,
  };
}

export function createBearerReader(o: BearerReaderOptions): TokenReader {
  const auth = plainIdentifier(o.authSchema ?? 'auth', 'auth schema');
  const tokens = `${auth}.tokens`;
  const { fence, live } = bearerLiveSql({ auth, tokens });
  const byHash = `SELECT t.id, t.user_id, t.audience, t.scope, t.expires_at, t.issued_by, u.email, u."emailVerified" AS email_verified
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
        ...(row.issued_by ? { issuedBy: row.issued_by } : {}),
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

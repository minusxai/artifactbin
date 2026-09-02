/**
 * OAuth 2.1 for `/mcp`. Authorization codes, dynamically registered clients,
 * and rotating refresh tokens live in the proxy-owned `auth` schema. Access
 * tokens remain the app's `mx_` tokens and are minted through the upstream as
 * the consenting session actor.
 */
import { createHash, randomBytes } from 'node:crypto';
import type { CodeStore, Queryable } from '@artifactbin/contracts';

export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const ACCESS_TOKEN_TTL_SECONDS = 6 * 60 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MCP_SCOPE = 'artifacts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');

export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

export const isValidCodeChallenge = (value: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(value);
export const isValidCodeVerifier = (value: string): boolean => /^[A-Za-z0-9._~-]{43,128}$/.test(value);

/**
 * OAuth redirect matching is exact. The sole native-app exception is an HTTP
 * loopback redirect registered without knowledge of the next ephemeral port:
 * the host, path, and query remain exact and only the port may differ.
 */
export function sameRedirectTarget(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  let a: URL;
  let b: URL;
  try { a = new URL(registered); b = new URL(requested); } catch { return false; }
  return a.protocol === 'http:'
    && b.protocol === 'http:'
    && LOOPBACK_HOSTS.has(a.hostname)
    && a.hostname === b.hostname
    && a.pathname === b.pathname
    && a.search === b.search
    && !a.hash && !b.hash
    && !a.username && !b.username;
}

export interface AuthorizationGrant {
  userId: string | null;
  clientId: string;
  redirectUri: string;
  resource: string;
  scope: string;
}

export async function createAuthCode(
  codes: CodeStore,
  grant: AuthorizationGrant,
  codeChallenge: string,
  now = Date.now(),
): Promise<string> {
  const code = randomBytes(24).toString('base64url');
  await codes.issue({
    kind: 'oauth',
    secret: code,
    payload: {
      user_id: grant.userId,
      client_id: grant.clientId,
      redirect_uri: grant.redirectUri,
      resource: grant.resource,
      scope: grant.scope,
      code_challenge: codeChallenge,
    },
    ttlMs: AUTH_CODE_TTL_MS,
    now,
  });
  return code;
}

export async function consumeAuthCode(
  codes: CodeStore,
  input: { code: string; clientId: string; redirectUri: string; resource: string; codeVerifier: string },
  now = Date.now(),
): Promise<AuthorizationGrant | null> {
  const row = (await codes.claimByHash({ kind: 'oauth', code: input.code, now })) as {
    user_id: string | null;
    client_id: string;
    redirect_uri: string;
    resource: string;
    scope: string;
    code_challenge: string;
  } | null;
  if (!row) return null;
  if (row.client_id !== input.clientId) return null;
  if (!sameRedirectTarget(row.redirect_uri, input.redirectUri)) return null;
  if (row.resource !== input.resource) return null;
  if (s256(input.codeVerifier) !== row.code_challenge) return null;
  return { userId: row.user_id, clientId: row.client_id, redirectUri: row.redirect_uri, resource: row.resource, scope: row.scope };
}

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
}

export interface RefreshGrant {
  token: string;
  clientId: string;
  userId: string;
  resource: string;
  scope: string;
}

export interface OAuthStore {
  register(body: Record<string, unknown>): Promise<Record<string, unknown>>;
  client(clientId: string): Promise<OAuthClient | null>;
  issueRefresh(grant: Omit<RefreshGrant, 'token'> & { accessTokenId: string }): Promise<string>;
  rotateRefresh(token: string, clientId: string, resource: string): Promise<RefreshGrant | null>;
  bindRefresh(token: string, accessTokenId: string): Promise<void>;
}

function identifier(value: string, what: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(value)) throw new Error(`${what} must be a plain lowercase identifier, got "${value}"`);
  return value;
}

function registration(body: Record<string, unknown>): { clientName: string; redirectUris: string[] } {
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.length === 0 || body.redirect_uris.length > 10 || !body.redirect_uris.every((uri) => typeof uri === 'string' && uri.length <= 2048 && isAllowedRedirectUri(uri))) {
    throw new Error('redirect_uris must be a non-empty array of secure HTTPS or HTTP loopback URLs');
  }
  if (body.token_endpoint_auth_method !== undefined && body.token_endpoint_auth_method !== 'none') throw new Error('only public clients are supported');
  if (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || body.grant_types.some((grant) => grant !== 'authorization_code' && grant !== 'refresh_token'))) {
    throw new Error('unsupported grant_types');
  }
  if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.some((type) => type !== 'code'))) throw new Error('unsupported response_types');
  return {
    clientName: typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 200) : 'MCP Client',
    redirectUris: [...new Set(body.redirect_uris as string[])],
  };
}

const refreshToken = (): string => `mxr_${randomBytes(32).toString('base64url')}`;

export function createOAuthStore(db: Queryable, schema = 'auth', appSchema?: string): OAuthStore {
  const s = identifier(schema, 'schema');
  const clients = `${s}.oauth_clients`;
  const refresh = `${s}.oauth_refresh_tokens`;
  const accessTokens = `${appSchema ? `${identifier(appSchema, 'app schema')}.` : ''}tokens`;
  const sweepRefresh = () => db.query(`DELETE FROM ${refresh} WHERE expires_at <= now()`);
  return {
    async register(body) {
      const valid = registration(body);
      const clientId = `mcp_${randomBytes(24).toString('base64url')}`;
      await db.query(
        `INSERT INTO ${clients} (client_id, client_name, redirect_uris) VALUES ($1, $2, $3)`,
        [clientId, valid.clientName, JSON.stringify(valid.redirectUris)],
      );
      return {
        client_id: clientId,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: valid.clientName,
        redirect_uris: valid.redirectUris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
    },
    async client(clientId) {
      const row = (await db.query<{ client_id: string; client_name: string; redirect_uris: string[] | string }>(
        `SELECT client_id, client_name, redirect_uris FROM ${clients} WHERE client_id = $1`,
        [clientId],
      )).rows[0];
      if (!row) return null;
      const redirectUris = typeof row.redirect_uris === 'string' ? JSON.parse(row.redirect_uris) as string[] : row.redirect_uris;
      return { clientId: row.client_id, clientName: row.client_name, redirectUris };
    },
    async issueRefresh(grant) {
      await sweepRefresh();
      const token = refreshToken();
      await db.query(
        `INSERT INTO ${refresh} (token_hash, family_id, client_id, user_id, resource, scope, access_token_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [hash(token), randomBytes(18).toString('base64url'), grant.clientId, grant.userId, grant.resource, grant.scope, grant.accessTokenId, new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString()],
      );
      return token;
    },
    async rotateRefresh(presented, clientId, resource) {
      await sweepRefresh();
      const next = refreshToken();
      const nextHash = hash(next);
      const oldHash = hash(presented);
      const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString();
      const row = (await db.query<{ client_id: string; user_id: string; resource: string; scope: string }>(
        `WITH consumed AS (
           UPDATE ${refresh}
              SET used_at = now()
            WHERE token_hash = $1 AND client_id = $2 AND resource = $3
              AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
              AND EXISTS (SELECT 1 FROM ${accessTokens} access WHERE access.id = access_token_id AND access.revoked_at IS NULL)
          RETURNING family_id, client_id, user_id, resource, scope, access_token_id
         ), inserted AS (
           INSERT INTO ${refresh} (token_hash, family_id, client_id, user_id, resource, scope, access_token_id, expires_at)
           SELECT $4, family_id, client_id, user_id, resource, scope, access_token_id, $5 FROM consumed
         )
         SELECT client_id, user_id, resource, scope FROM consumed`,
        [oldHash, clientId, resource, nextHash, expiresAt],
      )).rows[0];
      if (!row) {
        // Reuse of a rotated token is a family compromise signal. Expired,
        // unknown, and wrong-client values remain indistinguishable outside.
        await db.query(
          `UPDATE ${refresh} SET revoked_at = now()
            WHERE family_id = (SELECT family_id FROM ${refresh} WHERE token_hash = $1 AND client_id = $2 LIMIT 1)
              AND revoked_at IS NULL`,
          [oldHash, clientId],
        );
        return null;
      }
      return { token: next, clientId: row.client_id, userId: row.user_id, resource: row.resource, scope: row.scope };
    },
    async bindRefresh(token, accessTokenId) {
      await db.query(`UPDATE ${refresh} SET access_token_id = $2 WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL`, [hash(token), accessTokenId]);
    },
  };
}

export const authServerMetadata = (base: string): Record<string, unknown> => ({
  issuer: base,
  authorization_endpoint: `${base}/oauth/authorize`,
  token_endpoint: `${base}/oauth/token`,
  registration_endpoint: `${base}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: ['authorization_code', 'refresh_token'],
  scopes_supported: [MCP_SCOPE],
  code_challenge_methods_supported: ['S256'],
  token_endpoint_auth_methods_supported: ['none'],
});
export const protectedResourceMetadata = (base: string): Record<string, unknown> => ({
  resource: `${base}/mcp`,
  authorization_servers: [base],
  scopes_supported: [MCP_SCOPE],
  bearer_methods_supported: ['header'],
});
export { wwwAuthenticate } from '@artifactbin/utils';
export const s256 = (verifier: string): string => createHash('sha256').update(verifier).digest('base64url');

/** OAuth 2.1 for `/mcp`, implemented over the auth domain's clients and credentials. */
import { createHash, randomBytes } from 'node:crypto';
import type { Queryable } from '@artifactbin/contracts';

export const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const ACCESS_TOKEN_TTL_SECONDS = 6 * 60 * 60;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const MCP_SCOPE = 'artifacts';

const AUTHORIZATION_CODE = 'authorization_code';
const REFRESH_TOKEN = 'refresh_token';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const objectOf = (value: Record<string, unknown> | string): Record<string, unknown> =>
  typeof value === 'string' ? JSON.parse(value) as Record<string, unknown> : value;

export function isAllowedRedirectUri(uri: string): boolean {
  let url: URL;
  try { url = new URL(uri); } catch { return false; }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
}

export const isValidCodeChallenge = (value: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(value);
export const isValidCodeVerifier = (value: string): boolean => /^[A-Za-z0-9._~-]{43,128}$/.test(value);

/** Exact redirects, except that native HTTP loopback clients may change only their ephemeral port. */
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
  issueAuthorizationCode(grant: AuthorizationGrant, codeChallenge: string, now?: number): Promise<string>;
  consumeAuthorizationCode(input: { code: string; clientId: string; redirectUri: string; resource: string; codeVerifier: string }, now?: number): Promise<AuthorizationGrant | null>;
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
  if (body.grant_types !== undefined && (!Array.isArray(body.grant_types) || body.grant_types.some((grant) => grant !== AUTHORIZATION_CODE && grant !== REFRESH_TOKEN))) throw new Error('unsupported grant_types');
  if (body.response_types !== undefined && (!Array.isArray(body.response_types) || body.response_types.some((type) => type !== 'code'))) throw new Error('unsupported response_types');
  return {
    clientName: typeof body.client_name === 'string' && body.client_name.trim() ? body.client_name.trim().slice(0, 200) : 'MCP Client',
    redirectUris: [...new Set(body.redirect_uris as string[])],
  };
}

const refreshToken = (): string => `mxr_${randomBytes(32).toString('base64url')}`;

export function createOAuthStore(db: Queryable, schema = 'auth', appSchema?: string): OAuthStore {
  const s = identifier(schema, 'schema');
  const clients = `${s}.clients`;
  const credentials = `${s}.credentials`;
  const accessTokens = `${appSchema ? `${identifier(appSchema, 'app schema')}.` : ''}tokens`;
  const sweep = () => db.query(`DELETE FROM ${credentials} WHERE expires_at <= now()`);
  return {
    async register(body) {
      const valid = registration(body);
      const clientId = `mcp_${randomBytes(24).toString('base64url')}`;
      const metadata = {
        client_name: valid.clientName,
        redirect_uris: valid.redirectUris,
        grant_types: [AUTHORIZATION_CODE, REFRESH_TOKEN],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      };
      await db.query(`INSERT INTO ${clients} (id, kind, metadata) VALUES ($1, $2, $3)`, [clientId, 'public', JSON.stringify(metadata)]);
      return { client_id: clientId, client_id_issued_at: Math.floor(Date.now() / 1000), ...metadata };
    },
    async client(clientId) {
      const row = (await db.query<{ id: string; metadata: Record<string, unknown> | string }>(
        `SELECT id, metadata FROM ${clients} WHERE id = $1 AND revoked_at IS NULL`,
        [clientId],
      )).rows[0];
      if (!row) return null;
      const metadata = objectOf(row.metadata);
      return {
        clientId: row.id,
        clientName: typeof metadata.client_name === 'string' ? metadata.client_name : 'MCP Client',
        redirectUris: Array.isArray(metadata.redirect_uris) ? metadata.redirect_uris.filter((uri): uri is string => typeof uri === 'string') : [],
      };
    },
    async issueAuthorizationCode(grant, codeChallenge, now = Date.now()) {
      await sweep();
      const code = randomBytes(24).toString('base64url');
      await db.query(
        `INSERT INTO ${credentials} (kind, credential_hash, subject_id, payload, expires_at) VALUES ($1, $2, $3, $4, $5)`,
        [AUTHORIZATION_CODE, hash(code), grant.userId, JSON.stringify({ client_id: grant.clientId, redirect_uri: grant.redirectUri, resource: grant.resource, scope: grant.scope, code_challenge: codeChallenge }), new Date(now + AUTH_CODE_TTL_MS).toISOString()],
      );
      return code;
    },
    async consumeAuthorizationCode(input, now = Date.now()) {
      const row = (await db.query<{ subject_id: string | null; payload: Record<string, unknown> | string }>(
        `UPDATE ${credentials} SET consumed_at = $3
          WHERE kind = $1 AND credential_hash = $2 AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > $3
        RETURNING subject_id, payload`,
        [AUTHORIZATION_CODE, hash(input.code), new Date(now).toISOString()],
      )).rows[0];
      if (!row) return null;
      const payload = objectOf(row.payload);
      if (payload.client_id !== input.clientId) return null;
      if (typeof payload.redirect_uri !== 'string' || !sameRedirectTarget(payload.redirect_uri, input.redirectUri)) return null;
      if (payload.resource !== input.resource) return null;
      if (typeof payload.code_challenge !== 'string' || s256(input.codeVerifier) !== payload.code_challenge) return null;
      if (typeof payload.scope !== 'string') return null;
      return { userId: row.subject_id, clientId: input.clientId, redirectUri: payload.redirect_uri, resource: input.resource, scope: payload.scope };
    },
    async issueRefresh(grant) {
      await sweep();
      const token = refreshToken();
      await db.query(
        `INSERT INTO ${credentials} (kind, credential_hash, subject_id, group_id, payload, expires_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [REFRESH_TOKEN, hash(token), grant.userId, randomBytes(18).toString('base64url'), JSON.stringify({ client_id: grant.clientId, resource: grant.resource, scope: grant.scope, access_token_id: grant.accessTokenId }), new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString()],
      );
      return token;
    },
    async rotateRefresh(presented, clientId, resource) {
      await sweep();
      const next = refreshToken();
      const oldHash = hash(presented);
      const row = (await db.query<{ subject_id: string; group_id: string; payload: Record<string, unknown> | string }>(
        `WITH consumed AS (
           UPDATE ${credentials} AS current
              SET consumed_at = now()
            WHERE current.kind = $1 AND current.credential_hash = $2
              AND current.payload->>'client_id' = $3 AND current.payload->>'resource' = $4
              AND current.consumed_at IS NULL AND current.revoked_at IS NULL AND current.expires_at > now()
              AND EXISTS (SELECT 1 FROM ${accessTokens} access WHERE access.id = current.payload->>'access_token_id' AND access.revoked_at IS NULL)
          RETURNING current.subject_id, current.group_id, current.payload
         ), inserted AS (
           INSERT INTO ${credentials} (kind, credential_hash, subject_id, group_id, payload, expires_at)
           SELECT $1, $5, subject_id, group_id, payload, $6 FROM consumed
         )
         SELECT subject_id, group_id, payload FROM consumed`,
        [REFRESH_TOKEN, oldHash, clientId, resource, hash(next), new Date(Date.now() + REFRESH_TOKEN_TTL_MS).toISOString()],
      )).rows[0];
      if (!row) {
        await db.query(
          `UPDATE ${credentials} SET revoked_at = now()
            WHERE kind = $1 AND group_id = (
              SELECT group_id FROM ${credentials}
               WHERE kind = $1 AND credential_hash = $2 AND payload->>'client_id' = $3 LIMIT 1
            ) AND revoked_at IS NULL`,
          [REFRESH_TOKEN, oldHash, clientId],
        );
        return null;
      }
      const payload = objectOf(row.payload);
      if (typeof payload.scope !== 'string') return null;
      return { token: next, clientId, userId: row.subject_id, resource, scope: payload.scope };
    },
    async bindRefresh(token, accessTokenId) {
      await db.query(
        `UPDATE ${credentials} SET payload = payload || $3::jsonb
          WHERE kind = $1 AND credential_hash = $2 AND consumed_at IS NULL AND revoked_at IS NULL`,
        [REFRESH_TOKEN, hash(token), JSON.stringify({ access_token_id: accessTokenId })],
      );
    },
  };
}

export const createAuthCode = (store: OAuthStore, grant: AuthorizationGrant, codeChallenge: string, now = Date.now()): Promise<string> =>
  store.issueAuthorizationCode(grant, codeChallenge, now);
export const consumeAuthCode = (store: OAuthStore, input: { code: string; clientId: string; redirectUri: string; resource: string; codeVerifier: string }, now = Date.now()): Promise<AuthorizationGrant | null> =>
  store.consumeAuthorizationCode(input, now);

export const authServerMetadata = (base: string): Record<string, unknown> => ({
  issuer: base,
  authorization_endpoint: `${base}/oauth/authorize`,
  token_endpoint: `${base}/oauth/token`,
  registration_endpoint: `${base}/oauth/register`,
  response_types_supported: ['code'],
  grant_types_supported: [AUTHORIZATION_CODE, REFRESH_TOKEN],
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

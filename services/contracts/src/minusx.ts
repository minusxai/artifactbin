/**
 * ARTIFACTBIN ⇄ MINUSX, the wire half both sides implement (the cross-repository contract: §3 the delegation token,
 * §4.2 the read operations Artifactbin calls, §8 page data over a governed connection). Artifactbin mints the token
 * (services/app lib/minusx) and MinusX verifies it; neither side keeps a private variant of these shapes.
 */

/** The delegation's issuer, audience and JOSE `typ`: fixed strings, verified exactly by MinusX. */
export const DELEGATION_ISSUER = 'artifactbin-service';
export const DELEGATION_AUDIENCE = 'minusx-service';
export const DELEGATION_TYPE = 'mx-delegation+jwt';
/** A delegation's whole life (`exp - iat`): minted per request, never stored or reused. */
export const DELEGATION_TTL_SECONDS = 60;
/** What a delegation may be spent on; MinusX refuses one presented at an endpoint of another purpose. */
export type DelegationPurpose = 'database.connect' | 'catalog.read' | 'context.read';

/**
 * The delegation's claims (JWS compact, `alg: EdDSA`, header `{alg, typ: DELEGATION_TYPE, kid}`). `sub` is the user
 * Artifactbin vouches for and `active_group_id` the ONE group the request runs under; `request_sha256` is the hex
 * SHA-256 of the exact request body bytes (of the empty string when there is none).
 */
export interface DelegationClaims {
  iss: typeof DELEGATION_ISSUER;
  aud: typeof DELEGATION_AUDIENCE;
  sub: string;
  act: { sub: typeof DELEGATION_ISSUER };
  installation_id: string;
  active_group_id: string;
  session_ref?: string;
  page_id?: string;
  page_version?: string;
  purpose: DelegationPurpose;
  request_sha256: string;
  iat: number;
  exp: number;
  jti: string;
}

/** Every MinusX control route lives under this prefix of `MINUSX__BASE_URL`. */
export const MINUSX_API_PREFIX = '/api/v1';
/** A MinusX refusal: 401 unauthenticated, 403 forbidden, 404 not_found, 409 conflict, 422 invalid_request. */
export interface MinusxErrorBody { error: { code: string; message: string } }

type MinusxProtocol = 'postgres' | 'mysql';
/** `GET /connections`: only connections on which the caller's effective policy under its group is non-empty. */
interface MinusxConnection { id: string; name: string; protocol: MinusxProtocol; policy_revision: number | string }
export interface MinusxConnections { connections: MinusxConnection[] }
/** `GET /catalog?connection_id=…`: what the caller may query; models appear in schema `_views`. */
export interface MinusxCatalog {
  connection_id: string;
  policy_revision: number | string;
  default_schema: string | null;
  schemas: { name: string; tables: { name: string; kind: 'table' | 'model'; columns: { name: string; type: string }[]; description?: string; version?: number | string }[] }[];
}
/** `GET /context?connection_id=…`: the group's own context plus what it inherits from its ancestors. */
export interface MinusxContext {
  group_id: string;
  revision: number | string;
  docs: { title: string; body: string }[];
  metrics: { name: string; definition: string }[];
  models: { id: string; name: string; version: number | string; description: string; freshness?: string }[];
}
/**
 * `POST /connection-sessions` `{connection_id}`: a governed endpoint in the connection's own protocol and a
 * short-lived credential bound to caller + group + connection. `user` is the caller, `database` the connection;
 * `password` is single-purpose and never the upstream one.
 */
export interface MinusxConnectionSession {
  protocol: MinusxProtocol;
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  expires_at: string;
  policy_revision: number | string;
}

/**
 * A page function's governed connection: a `secrets` export binding of this kind (`{FIN: 'minusx'}`) names a MinusX
 * connection instead of a stored database login. Its stored value is a `MinusxBinding` the page's author set,
 * server-side; no password is ever stored for it.
 */
export const MINUSX_CONNECTION_KIND = 'minusx';
/** The binding of one connection name: the MinusX connection and the group the page's data is pinned to. */
export interface MinusxBinding { connection_id: string; group_id: string }

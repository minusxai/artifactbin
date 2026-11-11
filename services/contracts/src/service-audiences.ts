/**
 * SERVICES THAT ACCEPT THIS INSTALLATION'S IDENTITY TOKENS (`IDENTITY__SERVICE_AUDIENCES`, an identity-side setting,
 * empty by default). Each entry names another service by an `id` and the `origin` its tokens are bound to (the token's
 * audience), and may carry the SHA-256 (hex) of the secret that service presents to introspect (`IDENTITY_INTROSPECT_PATH`
 * with `SERVICE_AUTH_HEADER`): introspecting with it answers only for tokens of that one audience, so the service never
 * needs the installation's own service secret.
 *
 * Two kinds of token carry such an audience, and the identity module issues both:
 *  - a PERSON's token for that service (OAuth with `resource=<origin>`, or `/api/authentication/token` with
 *    `{"audience": "<id>"}`): a stored, refreshable grant, never admitted at this installation's own API;
 *  - a VIEWER token (`IdentityService.issueViewerToken`): minted only by a trusted first-party caller (the identity
 *    call path is service-authenticated) for the viewer it already knows, for ONE audience, living
 *    `VIEWER_TOKEN_TTL_SECONDS`, naming the page and function that asked. It is signed, not stored, and verified only
 *    by introspection.
 */
import { normalizeOrigin } from './server-identity';

export interface ServiceAudience {
  /** Lower-case id, e.g. `warehouse`: what a binding, a login (`--audience`) and the mint name the service by. */
  id: string;
  /** The audience its tokens carry: an origin (HTTPS, or HTTP on a local development host). */
  origin: string;
  /** Hex SHA-256 of the secret the service introspects with; null: it introspects with nothing of its own. */
  introspectionSecretSha256: string | null;
}

/** Who acts for the viewer in a viewer token's introspection answer (`actor.id`): this product's own server. */
export const FIRST_PARTY_ACTOR = 'artifactbin';

/** A viewer token's whole life (`exp - iat`): minted per use, never stored or refreshed. */
export const VIEWER_TOKEN_TTL_SECONDS = 60;

/** What asked for a viewer token, recorded in it and answered by introspection (for the service's audit). */
export interface ViewerTokenActor { artifactId?: string | null; function?: string | null }
export interface IssuedViewerToken {
  /** The bearer: handed only to the one service, never to page code, a URL, a log or storage. */
  token: string;
  /** The origin it is bound to. */
  audience: string;
  expiresAt: string;
}

const ID = /^[a-z][a-z0-9-]{0,62}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const WHAT = 'IDENTITY__SERVICE_AUDIENCES must be a JSON array of {"id": "<lower-case id>", "origin": "<https origin>", "introspection_secret_sha256"?: "<64 hex>"}';

/** The setting, validated whole: a malformed entry, a repeated id or origin, or an origin that is not one, throws naming it. */
export function parseServiceAudiences(raw: string | undefined): readonly ServiceAudience[] {
  if (raw === undefined || raw.trim() === '') return Object.freeze([]);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error(WHAT); }
  if (!Array.isArray(parsed)) throw new Error(WHAT);
  const out: ServiceAudience[] = [];
  for (const entry of parsed) {
    const e = entry as Record<string, unknown> | null;
    if (!e || typeof e !== 'object' || Array.isArray(e) || Object.keys(e).some((key) => !['id', 'origin', 'introspection_secret_sha256'].includes(key))) throw new Error(WHAT);
    const origin = typeof e.origin === 'string' ? normalizeOrigin(e.origin) : null;
    const secret = e.introspection_secret_sha256;
    if (typeof e.id !== 'string' || !ID.test(e.id) || !origin || (secret !== undefined && (typeof secret !== 'string' || !HEX64.test(secret)))) throw new Error(WHAT);
    if (out.some((other) => other.id === e.id || other.origin === origin)) throw new Error(`IDENTITY__SERVICE_AUDIENCES repeats ${JSON.stringify(e.id)} or its origin`);
    out.push({ id: e.id, origin, introspectionSecretSha256: typeof secret === 'string' ? secret : null });
  }
  return Object.freeze(out);
}

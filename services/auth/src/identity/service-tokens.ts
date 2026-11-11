/**
 * EXCHANGED SERVICE TOKENS (contracts ./service-audiences `SERVICE_TOKEN_PATH`): "act as this person at that service",
 * issued to a person who already holds a credential here (an access token or a browser session) and verified by
 * introspection, here and nowhere else.
 *
 * REPRESENTATION: signed, not stored. `vwt_<claims>.<mac>`: base64url JSON claims and an HMAC-SHA-256 under a key
 * derived (HKDF) from AUTH__SECRET for this purpose alone. One HMAC to mint and one to verify, no row written and none
 * to sweep; the introspection that verifies it also reads the account's `active` and the parent credential's `live`,
 * so signing out, revoking the parent or deactivating the account ends it on the next check. The format never matches
 * an access token's (`TOKEN_RE`), so the bearer read refuses it before hashing: it cannot be used at this
 * installation's API.
 *
 * Claims: `sub` the person, `aud` the service's origin, `svc` its id, `iat`/`exp` (exp - iat =
 * SERVICE_TOKEN_TTL_SECONDS), `jti`, and `par`, the credential it was issued for. Verification refuses a bad MAC, any
 * other prefix or shape, an expired or future token, a lifetime over the limit, and an audience no longer configured.
 */
import {createHmac,hkdfSync,randomUUID,timingSafeEqual} from 'node:crypto';
import {SERVICE_TOKEN_TTL_SECONDS,type IssuedServiceToken,type ServiceAudience,type ServiceTokenParent} from '@artifactbin/contracts';

const SERVICE_TOKEN_PREFIX = 'vwt_';
const SKEW_S = 5;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** The verified claims of a service token. */
export interface ServiceTokenClaims {
  sub: string; aud: string; svc: string; iat: number; exp: number; jti: string;
  /** The credential it was issued for. */
  par: ServiceTokenParent;
}
const PARENT_KINDS: readonly string[] = ['token', 'session'];

/** The signing key, derived from the host's secret for service tokens only (a cookie or another use never shares it). */
export function serviceTokenKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('identity-viewer-token'), Buffer.from('v1'), 32));
}
const mac = (key: Buffer, body: string) => createHmac('sha256', key).update(SERVICE_TOKEN_PREFIX + body).digest('base64url');

/** A token for `service`, for `userId`'s own credential `parent`. */
export function signServiceToken(key: Buffer, service: ServiceAudience, input: {userId: string; parent: ServiceTokenParent}, now = Date.now()): IssuedServiceToken {
  if (!ID.test(input.userId)) throw new Error('invalid_user');
  const parent = input.parent;
  if (!parent || !PARENT_KINDS.includes(parent.kind) || !ID.test(parent.id)) throw new Error('invalid_parent');
  const iat = Math.floor(now / 1000), exp = iat + SERVICE_TOKEN_TTL_SECONDS;
  const claims: ServiceTokenClaims = {sub: input.userId, aud: service.origin, svc: service.id, iat, exp, jti: `vtk_${randomUUID()}`, par: {kind: parent.kind, id: parent.id}};
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return {token: `${SERVICE_TOKEN_PREFIX}${body}.${mac(key, body)}`, audience: service.origin, expiresAt: new Date(exp * 1000).toISOString()};
}

/** Is `token` shaped like a service token at all (so introspection takes this path, never the bearer read's)? */
export const isServiceToken = (token: string): boolean => token.startsWith(SERVICE_TOKEN_PREFIX);

/** The claims of a valid, unexpired service token for a configured audience, or null. Never throws on input. */
export function verifyServiceToken(key: Buffer, audiences: readonly ServiceAudience[], token: string, now = Date.now()): ServiceTokenClaims | null {
  if (!isServiceToken(token) || token.length > 2048) return null;
  const [body, signature, extra] = token.slice(SERVICE_TOKEN_PREFIX.length).split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(key, body)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let c: ServiceTokenClaims;
  try { c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ServiceTokenClaims; } catch { return null; }
  const nowS = Math.floor(now / 1000);
  if (!c || typeof c !== 'object' || typeof c.sub !== 'string' || !ID.test(c.sub) || typeof c.aud !== 'string' || typeof c.svc !== 'string' || typeof c.jti !== 'string'
    || !c.par || typeof c.par !== 'object' || !PARENT_KINDS.includes(c.par.kind) || typeof c.par.id !== 'string' || !ID.test(c.par.id)
    || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp) || c.exp - c.iat > SERVICE_TOKEN_TTL_SECONDS || c.iat > nowS + SKEW_S || c.exp <= nowS) return null;
  if (!audiences.some(service => service.id === c.svc && service.origin === c.aud)) return null;
  return c;
}

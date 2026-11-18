/**
 * THE SIGNED TOKEN FORMAT, one implementation for every kind (exchanged service tokens ./service-tokens, artifact read
 * grants ./artifact-read-grants): `<prefix><claims>.<mac>`, base64url JSON claims and an HMAC-SHA-256 over prefix and
 * claims under a key derived (HKDF) from the host's secret for that kind alone. A kind is its prefix, its HKDF info and
 * its lifetime; the claims and their check are shared, so the kinds cannot drift apart.
 *
 * Claims: `sub` the person, `aud` the service's origin, `svc` its id, `iat`/`exp` (exp - iat = the kind's lifetime),
 * `jti`, and `par`, the credential it was issued for. Verification refuses a bad MAC, any other prefix or shape, an
 * expired or future token, a lifetime over the kind's, and an audience no longer configured.
 */
import {createHmac,hkdfSync,randomUUID,timingSafeEqual} from 'node:crypto';
import {type IssuedServiceToken,type ServiceAudience,type ServiceTokenParent} from '@artifactbin/contracts';

const SKEW_S = 5;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const PARENT_KINDS: readonly string[] = ['token', 'session'];

/** The verified claims of a signed token. */
export interface SignedTokenClaims {
  sub: string; aud: string; svc: string; iat: number; exp: number; jti: string;
  /** The credential it was issued for. */
  par: ServiceTokenParent;
}

/** One kind of signed token: what it starts with, the HKDF info its key is derived with, and its lifetime. */
export interface SignedTokenKind { prefix: string; keyInfo: string; ttlSeconds: number }

/** The kind's signing key, derived from the host's secret for that kind only (a cookie or another use never shares it). */
export function signedTokenKey(kind: SignedTokenKind, secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(kind.keyInfo), Buffer.from('v1'), 32));
}
const mac = (kind: SignedTokenKind, key: Buffer, body: string) => createHmac('sha256', key).update(kind.prefix + body).digest('base64url');

/** A token of this kind for `service`, for `userId`'s own credential `parent`. */
export function signToken(kind: SignedTokenKind, key: Buffer, service: ServiceAudience, input: {userId: string; parent: ServiceTokenParent}, now = Date.now()): IssuedServiceToken {
  if (!ID.test(input.userId)) throw new Error('invalid_user');
  const parent = input.parent;
  if (!parent || !PARENT_KINDS.includes(parent.kind) || !ID.test(parent.id)) throw new Error('invalid_parent');
  const iat = Math.floor(now / 1000), exp = iat + kind.ttlSeconds;
  const claims: SignedTokenClaims = {sub: input.userId, aud: service.origin, svc: service.id, iat, exp, jti: `vtk_${randomUUID()}`, par: {kind: parent.kind, id: parent.id}};
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return {token: `${kind.prefix}${body}.${mac(kind, key, body)}`, audience: service.origin, expiresAt: new Date(exp * 1000).toISOString()};
}

/** The claims of a valid, unexpired token of this kind for a configured audience, or null. Never throws on input. */
export function verifyToken(kind: SignedTokenKind, key: Buffer, audiences: readonly ServiceAudience[], token: string, now = Date.now()): SignedTokenClaims | null {
  if (!token.startsWith(kind.prefix) || token.length > 2048) return null;
  const [body, signature, extra] = token.slice(kind.prefix.length).split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(kind, key, body)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let c: SignedTokenClaims;
  try { c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SignedTokenClaims; } catch { return null; }
  const nowS = Math.floor(now / 1000);
  if (!c || typeof c !== 'object' || typeof c.sub !== 'string' || !ID.test(c.sub) || typeof c.aud !== 'string' || typeof c.svc !== 'string' || typeof c.jti !== 'string'
    || !c.par || typeof c.par !== 'object' || !PARENT_KINDS.includes(c.par.kind) || typeof c.par.id !== 'string' || !ID.test(c.par.id)
    || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp) || c.exp - c.iat > kind.ttlSeconds || c.iat > nowS + SKEW_S || c.exp <= nowS) return null;
  if (!audiences.some(service => service.id === c.svc && service.origin === c.aud)) return null;
  return c;
}

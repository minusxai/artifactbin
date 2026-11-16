/** Domain-separated purpose-only grants; identity checks parent liveness on every use. */
import {createHmac,hkdfSync,randomUUID,timingSafeEqual} from 'node:crypto';
import {type IssuedServiceToken,type ServiceAudience,type ServiceTokenParent} from '@artifactbin/contracts';

const GRANT_PREFIX = 'arg_';
const SKEW_S = 5;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;

/** The verified claims of a artifact read grant. */
export interface ArtifactReadClaims {
  sub: string; aud: string; svc: string; iat: number; exp: number; jti: string;
  /** The credential it was issued for. */
  par: ServiceTokenParent;
}
const PARENT_KINDS: readonly string[] = ['token', 'session'];

/** The signing key, derived from the host's secret for artifact read grants only (a cookie or another use never shares it). */
export function artifactReadKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('identity-artifact-read-grant'), Buffer.from('v1'), 32));
}
const mac = (key: Buffer, body: string) => createHmac('sha256', key).update(GRANT_PREFIX + body).digest('base64url');

/** A token for `service`, for `userId`'s own credential `parent`. */
export function signArtifactReadGrant(key: Buffer, service: ServiceAudience, input: {userId: string; parent: ServiceTokenParent}, now = Date.now()): IssuedServiceToken {
  if (!ID.test(input.userId)) throw new Error('invalid_user');
  const parent = input.parent;
  if (!parent || !PARENT_KINDS.includes(parent.kind) || !ID.test(parent.id)) throw new Error('invalid_parent');
  const iat = Math.floor(now / 1000), exp = iat + 3600;
  const claims: ArtifactReadClaims = {sub: input.userId, aud: service.origin, svc: service.id, iat, exp, jti: `vtk_${randomUUID()}`, par: {kind: parent.kind, id: parent.id}};
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return {token: `${GRANT_PREFIX}${body}.${mac(key, body)}`, audience: service.origin, expiresAt: new Date(exp * 1000).toISOString()};
}

/** Is `token` shaped like a artifact read grant at all (never accepted as a general API bearer)? */
const isArtifactReadGrant = (token: string): boolean => token.startsWith(GRANT_PREFIX);

/** The claims of a valid, unexpired artifact read grant for a configured audience, or null. Never throws on input. */
export function verifyArtifactReadGrant(key: Buffer, audiences: readonly ServiceAudience[], token: string, now = Date.now()): ArtifactReadClaims | null {
  if (!isArtifactReadGrant(token) || token.length > 2048) return null;
  const [body, signature, extra] = token.slice(GRANT_PREFIX.length).split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(key, body)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let c: ArtifactReadClaims;
  try { c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ArtifactReadClaims; } catch { return null; }
  const nowS = Math.floor(now / 1000);
  if (!c || typeof c !== 'object' || typeof c.sub !== 'string' || !ID.test(c.sub) || typeof c.aud !== 'string' || typeof c.svc !== 'string' || typeof c.jti !== 'string'
    || !c.par || typeof c.par !== 'object' || !PARENT_KINDS.includes(c.par.kind) || typeof c.par.id !== 'string' || !ID.test(c.par.id)
    || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp) || c.exp - c.iat > 3600 || c.iat > nowS + SKEW_S || c.exp <= nowS) return null;
  if (!audiences.some(service => service.id === c.svc && service.origin === c.aud)) return null;
  return c;
}

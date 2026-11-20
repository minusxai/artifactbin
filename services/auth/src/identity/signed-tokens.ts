/**
 * THE SIGNED TOKEN FORMAT, one implementation for every kind (a person's and a group's exchanged service tokens,
 * ./service-tokens): `<prefix><claims>.<mac>`, base64url JSON claims and an HMAC-SHA-256 over prefix and
 * claims under a key derived (HKDF) from the host's secret for that kind alone. A kind is its prefix, its HKDF info and
 * its lifetime; the claims and their check are shared, so the kinds cannot drift apart.
 *
 * Claims: `sub` the person, `aud` the service's origin, `svc` its id, `iat`/`exp` (exp - iat = the kind's lifetime),
 * `jti`, and `par`, the credential it was issued for. Verification refuses a bad MAC, any other prefix or shape, an
 * expired or future token, a lifetime over the kind's, and an audience no longer configured.
 *
 * A GROUP's kind (`principal: 'group'`, ./service-tokens) carries no `sub` at all: `grp` the group, `rol` its level
 * (`member` or `editor`), `isb` who issued the group's sign-in, and `par` that sign-in (always a `token`). Its `exp`
 * may be earlier than iat + lifetime (never past its parent). A person's kind refuses any claims without `sub`, so a
 * group's claims are never read as a person's, under any key; a group's kind refuses any claims with one.
 */
import {createHmac,hkdfSync,randomUUID,timingSafeEqual} from 'node:crypto';
import {isGroupPrincipalRole, type GroupPrincipalRole} from '@artifactbin/contracts/actor';
import type {IssuedServiceToken, ServiceAudience, ServiceTokenParent} from '@artifactbin/contracts/service-audiences';

const SKEW_S = 5;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const PARENT_KINDS: readonly string[] = ['token', 'session'];

/** The verified claims of a signed token. */
export interface SignedTokenClaims {
  sub: string; aud: string; svc: string; iat: number; exp: number; jti: string;
  /** The credential it was issued for. */
  par: ServiceTokenParent;
}
/** The verified claims of a group's signed token: the group, its level, who issued its sign-in, and that sign-in. */
export interface GroupSignedTokenClaims {
  grp: string; rol: GroupPrincipalRole; isb: string; aud: string; svc: string; iat: number; exp: number; jti: string;
  par: {kind: 'token'; id: string};
}

/** One kind of signed token: what it starts with, the HKDF info its key is derived with, its lifetime, and whose it is. */
export interface SignedTokenKind { prefix: string; keyInfo: string; ttlSeconds: number; principal?: 'group' }

/** The kind's signing key, derived from the host's secret for that kind only (a cookie or another use never shares it). */
export function signedTokenKey(kind: SignedTokenKind, secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(kind.keyInfo), Buffer.from('v1'), 32));
}
const mac = (kind: SignedTokenKind, key: Buffer, body: string) => createHmac('sha256', key).update(kind.prefix + body).digest('base64url');
const seal = (kind: SignedTokenKind, key: Buffer, claims: object) => {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${kind.prefix}${body}.${mac(kind, key, body)}`;
};

/** A token of this kind for `service`, for `userId`'s own credential `parent`. */
export function signToken(kind: SignedTokenKind, key: Buffer, service: ServiceAudience, input: {userId: string; parent: ServiceTokenParent}, now = Date.now()): IssuedServiceToken {
  if (kind.principal) throw new Error('invalid_kind');
  if (!ID.test(input.userId)) throw new Error('invalid_user');
  const parent = input.parent;
  if (!parent || !PARENT_KINDS.includes(parent.kind) || !ID.test(parent.id)) throw new Error('invalid_parent');
  const iat = Math.floor(now / 1000), exp = iat + kind.ttlSeconds;
  const claims: SignedTokenClaims = {sub: input.userId, aud: service.origin, svc: service.id, iat, exp, jti: `vtk_${randomUUID()}`, par: {kind: parent.kind, id: parent.id}};
  return {token: seal(kind, key, claims), audience: service.origin, expiresAt: new Date(exp * 1000).toISOString()};
}

/**
 * A group's token of this kind for `service`, for the group sign-in `parent` (a `tokens` row), ending at the kind's
 * lifetime or at `notAfter` (ms, the parent's own expiry), whichever is sooner. Throws when that is already past.
 */
export function signGroupToken(kind: SignedTokenKind, key: Buffer, service: ServiceAudience,
  input: {group: {id: string; role: GroupPrincipalRole; issuedBy: string}; parent: {kind: 'token'; id: string}; notAfter: number | null}, now = Date.now()): IssuedServiceToken {
  if (kind.principal !== 'group') throw new Error('invalid_kind');
  const {group, parent} = input;
  if (!group || !ID.test(group.id) || !isGroupPrincipalRole(group.role) || !ID.test(group.issuedBy)) throw new Error('invalid_group');
  if (!parent || parent.kind !== 'token' || !ID.test(parent.id)) throw new Error('invalid_parent');
  const iat = Math.floor(now / 1000);
  const exp = Math.min(iat + kind.ttlSeconds, input.notAfter === null ? Infinity : Math.floor(input.notAfter / 1000));
  if (!Number.isSafeInteger(exp) || exp <= iat) throw new Error('parent_expiring');
  const claims: GroupSignedTokenClaims = {grp: group.id, rol: group.role, isb: group.issuedBy, aud: service.origin, svc: service.id, iat, exp, jti: `vtk_${randomUUID()}`, par: {kind: 'token', id: parent.id}};
  return {token: seal(kind, key, claims), audience: service.origin, expiresAt: new Date(exp * 1000).toISOString()};
}

/** The claims of a correctly signed token of this kind whose shared fields (audience, times, id) hold, or null. */
function open(kind: SignedTokenKind, key: Buffer, audiences: readonly ServiceAudience[], token: string, now: number): Record<string, unknown> | null {
  if (!token.startsWith(kind.prefix) || token.length > 2048) return null;
  const [body, signature, extra] = token.slice(kind.prefix.length).split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(kind, key, body)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let c: Record<string, unknown>;
  try { c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>; } catch { return null; }
  const nowS = Math.floor(now / 1000);
  if (!c || typeof c !== 'object' || typeof c.aud !== 'string' || typeof c.svc !== 'string' || typeof c.jti !== 'string'
    || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp) || (c.exp as number) - (c.iat as number) > kind.ttlSeconds
    || (c.iat as number) > nowS + SKEW_S || (c.exp as number) <= nowS) return null;
  if (!audiences.some(service => service.id === c.svc && service.origin === c.aud)) return null;
  return c;
}

/** The claims of a valid, unexpired token of this kind for a configured audience, or null. Never throws on input. */
export function verifyToken(kind: SignedTokenKind, key: Buffer, audiences: readonly ServiceAudience[], token: string, now = Date.now()): SignedTokenClaims | null {
  if (kind.principal) return null;
  const c = open(kind, key, audiences, token, now) as Partial<SignedTokenClaims> | null;
  if (!c || typeof c.sub !== 'string' || !ID.test(c.sub)
    || !c.par || typeof c.par !== 'object' || !PARENT_KINDS.includes(c.par.kind) || typeof c.par.id !== 'string' || !ID.test(c.par.id)) return null;
  return c as SignedTokenClaims;
}

/** The claims of a valid, unexpired group's token of this kind for a configured audience, or null. Never throws on input. */
export function verifyGroupToken(kind: SignedTokenKind, key: Buffer, audiences: readonly ServiceAudience[], token: string, now = Date.now()): GroupSignedTokenClaims | null {
  if (kind.principal !== 'group') return null;
  const c = open(kind, key, audiences, token, now) as Partial<GroupSignedTokenClaims> & {sub?: unknown} | null;
  if (!c || 'sub' in c || typeof c.grp !== 'string' || !ID.test(c.grp) || !isGroupPrincipalRole(c.rol) || typeof c.isb !== 'string' || !ID.test(c.isb)
    || !c.par || typeof c.par !== 'object' || c.par.kind !== 'token' || typeof c.par.id !== 'string' || !ID.test(c.par.id)) return null;
  return c as GroupSignedTokenClaims;
}

/**
 * THE SIGNED ACTOR — for the one place identity crosses a NETWORK: the
 * over-HTTP upstream adapter and its receiver part. In-process the actor
 * rides on the Request object (`attachActor`) and nothing is signed.
 *
 * ONE implementation, both sides import it: two implementations of "the
 * same" HMAC is how a proxy signs something the app rejects.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CREDENTIALS, isGroupActorRole, type Actor, type Credential, type HumanActor } from '@artifactbin/contracts/actor';

/** Default lifetime of a signed header. Short: it is minted per request. */
const ACTOR_TTL_SECONDS = 120;

/** Tolerated clock difference between proxy and app. */
const SKEW_SECONDS = 30;

type Claims = Actor & { iat:number; exp:number };
/** A group principal's fields (contracts `GroupActor`): all of them or none, never beside a person's. */
const GROUP_FIELDS = ['principal', 'principalGroupId', 'principalGroupRole', 'issuedBy'] as const;

function canonical(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return JSON.stringify(Object.fromEntries(keys.map((k) => [k, obj[k]])));
}

function hmac(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function signActor(actor: Actor, secret: string, opts: { now?: number; ttlSeconds?: number } = {}): string {
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const claims: Claims = { ...actor, iat: now, exp: now + (opts.ttlSeconds ?? ACTOR_TTL_SECONDS) };
  const payload = Buffer.from(canonical(claims as unknown as Record<string, unknown>)).toString('base64url');
  return `${payload}.${hmac(payload, secret)}`;
}

function isCredential(v: unknown): v is Credential {
  return typeof v === 'string' && (CREDENTIALS as readonly string[]).includes(v);
}

export function verifyActor(header: string | null | undefined, secret: string, opts: { now?: number } = {}): Actor | null {
  if (!header) return null;
  const dot = header.indexOf('.');
  if (dot <= 0) return null;
  const payload = header.slice(0, dot);
  const sig = header.slice(dot + 1);
  const expected = hmac(payload, secret);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let claims: Partial<Claims>;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object' || !isCredential(claims.credential)) return null;
  if (typeof claims.iat !== 'number' || typeof claims.exp !== 'number') return null;
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  if (claims.exp + SKEW_SECONDS < now) return null;
  if (claims.iat - SKEW_SECONDS > now) return null;
  const raw = claims as Record<string, unknown>;
  // A claim naming a workload (a kind this release no longer has) is no one, never a person or a group.
  if (raw.workload !== undefined || raw.serviceWorkload !== undefined) return null;
  // A GROUP's sign-in: exactly its own fields, a bearer, and nothing of a person's; a partial or mixed claim is no one.
  if (GROUP_FIELDS.some((key) => raw[key] !== undefined)) {
    const exact = Object.keys(raw).every((key) => ['credential', 'tokenId', 'iat', 'exp', ...GROUP_FIELDS].includes(key));
    const role = raw.principalGroupRole;
    return exact && raw.credential === 'bearer' && raw.principal === 'group' && typeof raw.principalGroupId === 'string' && !!raw.principalGroupId
      && isGroupActorRole(role) && typeof raw.tokenId === 'string' && !!raw.tokenId && typeof raw.issuedBy === 'string' && !!raw.issuedBy
      ? { credential: 'bearer', principal: 'group', principalGroupId: raw.principalGroupId, principalGroupRole: role, tokenId: raw.tokenId, issuedBy: raw.issuedBy }
      : null;
  }
  const actor: HumanActor = { credential: claims.credential as Credential };
  if (typeof claims.userId === 'string') actor.userId = claims.userId;
  if (typeof claims.tokenId === 'string') actor.tokenId = claims.tokenId;
  if (typeof claims.email === 'string') actor.email = claims.email;
  if (typeof claims.sessionId === 'string') actor.sessionId = claims.sessionId;
  if (typeof claims.emailVerified === 'boolean') actor.emailVerified = claims.emailVerified;
  return actor;
}

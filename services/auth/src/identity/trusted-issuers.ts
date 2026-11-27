/**
 * The trusted sign-in form (POST /api/auth/trusted-sign-in) carries one Ed25519 JWT. The deployment selects the
 * verification key by issuer and allowed Origin. Each issuer has one audience and one live parent ceiling. Each group's
 * parent_handles runs outermost first and must resolve inside that ceiling. The receiver checks audience and time,
 * spends the jti once, then writes identities and membership changes in ../identity-store/trusted-sign-in.
 */
import {createPublicKey, verify, type KeyObject} from 'node:crypto';
import {isValidHandle} from '@artifactbin/contracts/handles';
import {displayName} from '@artifactbin/contracts/account-resource';
import {readEnv} from '../env';

export const TRUSTED_SIGNIN_PATH = '/api/auth/trusted-sign-in';
const MAX_LIFETIME_S = 300;
const CLOCK_SKEW_S = 30;

export interface TrustedIssuer {
  issuer: string;
  audience: string;
  keysByOrigin: ReadonlyMap<string, readonly KeyObject[]>;
  parentGroup: string;
}

const fail = (message: string): never => { throw new Error(`TRUSTED_SIGNIN__ISSUERS: ${message}`); };

export function joinsCompanyRoot(env: Record<string, string | undefined>): boolean {
  const value = readEnv(env, 'TRUSTED_SIGNIN__JOIN_COMPANY_ROOT');
  if (value === undefined || value === '' || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error('TRUSTED_SIGNIN__JOIN_COMPANY_ROOT must be true or false');
}

/** The configured issuers by name; empty when the setting is unset. A malformed value stops the boot, naming the setting (never a key). */
export function trustedIssuersOf(env: Record<string, string | undefined>): ReadonlyMap<string, TrustedIssuer> {
  const raw = readEnv(env, 'TRUSTED_SIGNIN__ISSUERS')?.trim();
  const issuers = new Map<string, TrustedIssuer>();
  if (!raw) return issuers;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return fail('must be a JSON array'); }
  if (!Array.isArray(parsed)) fail('must be a JSON array');
  for (const entry of parsed as unknown[]) {
    const e = entry as Record<string, unknown> | null;
    if (!e || typeof e !== 'object') fail('every entry must be an object');
    const {issuer, audience, origins, publicJwk, parentGroup} = e!;
    if (typeof issuer !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(issuer)) fail('issuer must be 1-40 lowercase letters, digits or hyphens');
    if (typeof audience !== 'string' || !audience.trim()) fail(`issuer ${issuer}: audience must be a nonempty string`);
    if (!Array.isArray(origins) || !origins.length || origins.some(o => typeof o !== 'string' || !isOrigin(o))) fail(`issuer ${issuer}: origins must be a nonempty list of origins (scheme://host[:port])`);
    if (typeof parentGroup !== 'string' || !parentGroup.trim()) fail(`issuer ${issuer}: parentGroup must be a nonempty string`);
    const jwk = publicJwk as Record<string, unknown> | null;
    if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || 'd' in jwk) fail(`issuer ${issuer}: publicJwk must be a public Ed25519 OKP key`);
    let key: KeyObject;
    try { key = createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: jwk!.x as string}, format: 'jwk'}); } catch { return fail(`issuer ${issuer}: publicJwk is not a valid key`); }
    const previous = issuers.get(issuer as string);
    if (previous && (previous.audience !== audience || previous.parentGroup !== parentGroup))
      fail(`issuer ${issuer}: entries must agree on audience and parentGroup`);
    const keysByOrigin = new Map(previous?.keysByOrigin);
    for (const origin of new Set(origins as string[])) keysByOrigin.set(origin, [...(keysByOrigin.get(origin) ?? []), key]);
    issuers.set(issuer as string, {issuer: issuer as string, audience: audience as string, keysByOrigin, parentGroup: parentGroup as string});
  }
  return issuers;
}

function isOrigin(value: string): boolean {
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value; } catch { return false; }
}

export interface TrustedGroup { handle: string; name?: string; tenancyId: string; parentHandles: string[] }
export interface TrustedClaims {
  issuer: TrustedIssuer; subject: string; groups: TrustedGroup[]; activeGroup?: string;
  name?: string; previousHandle?: string; jti: string; exp: number;
}
export type TrustedTokenRefusal = 'invalid_token' | 'unknown_issuer' | 'forbidden_origin' | 'replayed_token';
/** A refused token: the refusal the caller is told, and for the operator's log which check refused it, the issuer once
 * known and, once the signature holds, how far its times sit from this server's clock. Never a value from the token. */
export interface TrustedTokenFailure { ok: false; refusal: TrustedTokenRefusal; reason: string; issuer?: string; expiresIn?: number; issuedAgo?: number }

const json = (part: string): Record<string, unknown> | null => {
  try { const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; }
};
const plain = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

function validPath(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 16 &&
    value.every(handle => typeof handle === 'string' && isValidHandle(handle)) && new Set(value).size === value.length;
}

/**
 * The token's groups, or why they are refused (a short reason for the log, ../parts mountTrustedSignIn: never a value
 * from the token). A group name that is not a usable label (empty, too long, control characters) carries no name, as
 * displayName says, rather than refusing the sign-in.
 */
function membershipClaims(payload: Record<string, unknown>): Pick<TrustedClaims,'groups'|'activeGroup'> | string {
  const legacy = ['group','group_name','tenancy_id','parent_groups'].find(field => field in payload);
  if (legacy) return `legacy_claim:${legacy}`;
  const list = payload.groups;
  if (!Array.isArray(list)) return 'groups_not_a_list';
  if (list.length > 256) return `too_many_groups:${list.length}`;
  const groups: TrustedGroup[] = [];
  const handles = new Set<string>();
  for (const [index, entry] of list.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return `group_${index}:not_an_object`;
    const {handle, name, tenancy_id, parent_handles} = entry;
    if (typeof handle !== 'string' || !isValidHandle(handle)) return `group_${index}:handle`;
    if (handles.has(handle)) return `group_${index}:duplicate_handle`;
    if (!plain(tenancy_id,200)) return `group_${index}:tenancy_id`;
    if (!validPath(parent_handles) || parent_handles.includes(handle)) return `group_${index}:parent_handles`;
    handles.add(handle);
    groups.push({handle, name:displayName(name), tenancyId:tenancy_id, parentHandles:parent_handles});
  }
  const active = payload.active_group;
  if (active !== undefined && (typeof active !== 'string' || !handles.has(active))) return 'active_group';
  return {groups, activeGroup: typeof active === 'string' ? active : groups[0]?.handle};
}

/**
 * One verifier per mount: the issuers and the record of used `jti`s. Checks run in this order so that nothing a
 * forger controls costs anything: the issuer named, the request's Origin, the signature and claims, and only then the
 * `jti` is spent.
 */
export function createTrustedTokenVerifier(issuers: ReadonlyMap<string, TrustedIssuer>, now: () => number = () => Date.now()) {
  const used = new Map<string, number>();
  const prune = (at: number) => { for (const [id, exp] of used) if (exp * 1000 <= at) used.delete(id); };
  return {
    enabled: issuers.size > 0,
    verify(token: string, origin: string | undefined): {ok: true; claims: TrustedClaims} | TrustedTokenFailure {
      const parts = token.split('.');
      if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return {ok: false, refusal: 'invalid_token', reason: 'malformed'};
      const [head, body, signature] = parts as [string, string, string];
      const header = json(head), payload = json(body);
      if (!header || !payload || header.alg !== 'EdDSA' || 'crit' in header) return {ok: false, refusal: 'invalid_token', reason: 'header'};
      const issuer = typeof payload.iss === 'string' ? issuers.get(payload.iss) : undefined;
      if (!issuer) return {ok: false, refusal: 'unknown_issuer', reason: 'issuer'};
      const keys = origin && issuer.keysByOrigin.get(origin);
      if (!keys) return {ok: false, refusal: 'forbidden_origin', reason: 'origin', issuer: issuer.issuer};
      const message = Buffer.from(`${head}.${body}`), bytes = Buffer.from(signature, 'base64url');
      const issuerName = issuer.issuer;
      if (!keys.some(key => verify(null,message,key,bytes))) return {ok: false, refusal: 'invalid_token', reason: 'signature', issuer: issuerName};
      const at = now(), seconds = at / 1000;
      const {aud, exp, iat, jti, sub} = payload;
      const audienceOk = aud === issuer.audience || (Array.isArray(aud) && aud.length === 1 && aud[0] === issuer.audience);
      const timed = typeof exp === 'number' && typeof iat === 'number' && Number.isFinite(exp) && Number.isFinite(iat);
      // How far the token's times sit from this server's clock: what tells an expired token from a skewed clock.
      const times = timed ? {expiresIn: Math.round(exp - seconds), issuedAgo: Math.round(seconds - iat)} : {};
      const claimFault = !audienceOk ? 'audience' : !timed ? 'times' : exp <= seconds ? 'expired' : iat > seconds + CLOCK_SKEW_S ? 'issued_in_future'
        : exp <= iat || exp - iat > MAX_LIFETIME_S ? 'lifetime' : !plain(jti, 200) ? 'jti' : !plain(sub, 254) ? 'sub' : null;
      if (claimFault) return {ok: false, refusal: 'invalid_token', reason: claimFault, issuer: issuerName, ...times};
      // Every check above held: plain() proved jti and sub strings, `timed` the two numbers.
      const subject = sub as string, expires = exp as number;
      const previousHandle = payload.previous_handle;
      if (previousHandle !== undefined && (typeof previousHandle !== 'string' || !isValidHandle(previousHandle) || !subject.includes('@')))
        return {ok:false, refusal:'invalid_token', reason:'previous_handle', issuer: issuerName};
      const membership = membershipClaims(payload);
      if (typeof membership === 'string') return {ok:false, refusal:'invalid_token', reason:membership, issuer: issuerName, ...times};
      prune(at);
      const key = `${issuer.issuer}\u0000${jti}`;
      if (used.has(key)) return {ok: false, refusal: 'replayed_token', reason: 'replayed', issuer: issuerName, ...times};
      used.set(key, expires);
      return {ok: true, claims: {issuer, subject, ...membership, previousHandle, jti: jti as string, exp: expires, name:displayName(payload.name)}};
    },
  };
}

/** A same-origin path to land on after sign-in, or `/`: never another origin, a scheme-relative or backslashed address. */
export function trustedCallbackPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) return '/';
  const origin = 'http://callback.invalid';
  try {
    const url = new URL(value, origin);
    // Re-checked after normalising: `/a/..//evil.example` resolves to the scheme-relative `//evil.example`.
    return url.origin === origin && !url.pathname.startsWith('//') ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch { return '/'; }
}

/** A handle subject's address at this deployment: synthetic and undeliverable (`.invalid` is reserved, RFC 2606). */
export const trustedEmailOf = (issuer: string, subject: string): string => `${subject}@${issuer}.trusted-issuer.invalid`;

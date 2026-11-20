/**
 * TRUSTED-ISSUER SIGN-IN: another site the operator trusts signs a person in here with a short-lived signed token,
 * submitted by that site's page as a form (`POST /api/auth/trusted-sign-in`, `token` and an optional same-origin
 * `callbackUrl`), typically into a frame it draws. Off unless `TRUSTED_SIGNIN__ISSUERS` names an issuer:
 *
 *   [{"issuer":"<name>","audience":"<aud>","origins":["https://site.example"],"publicJwk":{"kty":"OKP","crv":"Ed25519","x":"…"},
 *     "parentGroup":"<group handle or id, optional>"}]
 *
 * The token is a compact JWS, EdDSA (Ed25519) only, verified with the issuer's public key: `iss` a configured issuer,
 * `aud` its audience, `exp` in the future, `iat` present and not ahead of now, at most 300 s between them, and `jti`
 * used once (a replayed `jti` is refused until its token expires; the record of used ids is this process's memory, so
 * a multi-process install accepts a token at most once per process). Claims: `sub` (the person's email address, or a
 * handle the issuer owns), `group` (the group's handle) and `tenancy_id` (the group's tenancy, fixed at its creation);
 * any other claim (such as `name`) is ignored. The request's
 * `Origin` must be one of the issuer's origins; every other sign-in keeps refusing foreign origins.
 * The identity writes are ../identity-store/trusted-sign-in.
 */
import {createPublicKey, verify, type KeyObject} from 'node:crypto';
import {readEnv} from '../env';

export const TRUSTED_SIGNIN_PATH = '/api/auth/trusted-sign-in';
const MAX_LIFETIME_S = 300;
const CLOCK_SKEW_S = 30;

export interface TrustedIssuer {
  issuer: string;
  audience: string;
  origins: readonly string[];
  key: KeyObject;
  parentGroup?: string;
}

const fail = (message: string): never => { throw new Error(`TRUSTED_SIGNIN__ISSUERS: ${message}`); };

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
    if (issuers.has(issuer as string)) fail(`issuer ${issuer} is named twice`);
    if (typeof audience !== 'string' || !audience.trim()) fail(`issuer ${issuer}: audience must be a nonempty string`);
    if (!Array.isArray(origins) || !origins.length || origins.some(o => typeof o !== 'string' || !isOrigin(o))) fail(`issuer ${issuer}: origins must be a nonempty list of origins (scheme://host[:port])`);
    if (parentGroup !== undefined && (typeof parentGroup !== 'string' || !parentGroup)) fail(`issuer ${issuer}: parentGroup must be a nonempty string`);
    const jwk = publicJwk as Record<string, unknown> | null;
    if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || 'd' in jwk) fail(`issuer ${issuer}: publicJwk must be a public Ed25519 OKP key`);
    let key: KeyObject;
    try { key = createPublicKey({key: {kty: 'OKP', crv: 'Ed25519', x: jwk!.x as string}, format: 'jwk'}); } catch { return fail(`issuer ${issuer}: publicJwk is not a valid key`); }
    issuers.set(issuer as string, {issuer: issuer as string, audience: audience as string, origins: origins as string[], key, ...(parentGroup ? {parentGroup: parentGroup as string} : {})});
  }
  return issuers;
}

function isOrigin(value: string): boolean {
  try { const url = new URL(value); return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value; } catch { return false; }
}

export interface TrustedClaims { issuer: TrustedIssuer; subject: string; group: string; tenancyId: string; jti: string; exp: number }
export type TrustedTokenRefusal = 'invalid_token' | 'unknown_issuer' | 'forbidden_origin' | 'replayed_token';

const json = (part: string): Record<string, unknown> | null => {
  try { const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8')); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; } catch { return null; }
};
const plain = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

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
    verify(token: string, origin: string | undefined): {ok: true; claims: TrustedClaims} | {ok: false; refusal: TrustedTokenRefusal} {
      const parts = token.split('.');
      if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return {ok: false, refusal: 'invalid_token'};
      const [head, body, signature] = parts as [string, string, string];
      const header = json(head), payload = json(body);
      if (!header || !payload || header.alg !== 'EdDSA' || 'crit' in header) return {ok: false, refusal: 'invalid_token'};
      const issuer = typeof payload.iss === 'string' ? issuers.get(payload.iss) : undefined;
      if (!issuer) return {ok: false, refusal: 'unknown_issuer'};
      if (!origin || !issuer.origins.includes(origin)) return {ok: false, refusal: 'forbidden_origin'};
      if (!verify(null, Buffer.from(`${head}.${body}`), issuer.key, Buffer.from(signature, 'base64url'))) return {ok: false, refusal: 'invalid_token'};
      const at = now(), seconds = at / 1000;
      const {aud, exp, iat, jti, sub, group, tenancy_id: tenancyId} = payload;
      const audienceOk = aud === issuer.audience || (Array.isArray(aud) && aud.length === 1 && aud[0] === issuer.audience);
      if (!audienceOk || typeof exp !== 'number' || typeof iat !== 'number' || !Number.isFinite(exp) || !Number.isFinite(iat)
        || exp <= seconds || iat > seconds + CLOCK_SKEW_S || exp <= iat || exp - iat > MAX_LIFETIME_S
        || !plain(jti, 200) || !plain(sub, 254) || !plain(group, 64) || !plain(tenancyId, 200)) return {ok: false, refusal: 'invalid_token'};
      prune(at);
      const key = `${issuer.issuer}\u0000${jti}`;
      if (used.has(key)) return {ok: false, refusal: 'replayed_token'};
      used.set(key, exp);
      return {ok: true, claims: {issuer, subject: sub, group, tenancyId, jti, exp}};
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

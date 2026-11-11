/**
 * VIEWER TOKENS (contracts ./service-audiences): "act for this viewer at that service", issued by the identity store
 * (`issueViewerToken`, first-party callers only) and verified by introspection, here and nowhere else.
 *
 * REPRESENTATION: signed, not stored. `vwt_<claims>.<mac>`: base64url JSON claims and an HMAC-SHA-256 under a key
 * derived (HKDF) from AUTH__SECRET for this purpose alone. A page data call costs one HMAC to mint and one to verify,
 * no row written and none to sweep; the introspection that verifies it also reads the account's `active` (one indexed
 * read), so a deactivated viewer is refused at once. What a stored row would add, revoking one token inside its
 * 60 seconds, a viewer token does not need: the service re-checks membership and account per statement itself, and
 * the token is only ever spent on one session request. The format never matches an access token's (`TOKEN_RE`), so
 * the bearer read refuses it before hashing: it cannot be used at this installation's API.
 *
 * Claims: `sub` the viewer, `aud` the service's origin, `svc` its id, `iat`/`exp` (exp - iat = VIEWER_TOKEN_TTL_SECONDS),
 * `jti`, and `act` (the page and function that asked). Verification refuses a bad MAC, any other prefix or shape, an
 * expired or future token, a lifetime over the limit, and an audience no longer configured.
 */
import {createHmac,hkdfSync,randomUUID,timingSafeEqual} from 'node:crypto';
import {VIEWER_TOKEN_TTL_SECONDS,type IssuedViewerToken,type ServiceAudience,type ViewerTokenActor} from '@artifactbin/contracts';

const VIEWER_TOKEN_PREFIX = 'vwt_';
const SKEW_S = 5;
const ID = /^[A-Za-z0-9_.:-]{1,128}$/;
const FUNCTION = /^[A-Za-z_$][A-Za-z0-9_$]{0,127}$/;

/** The verified claims of a viewer token. */
export interface ViewerClaims {
  sub: string; aud: string; svc: string; iat: number; exp: number; jti: string;
  act: {artifact_id: string | null; function: string | null};
}

/** The signing key, derived from the host's secret for viewer tokens only (a cookie or another use never shares it). */
export function viewerTokenKey(secret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from('identity-viewer-token'), Buffer.from('v1'), 32));
}
const mac = (key: Buffer, body: string) => createHmac('sha256', key).update(VIEWER_TOKEN_PREFIX + body).digest('base64url');

export function signViewerToken(key: Buffer, service: ServiceAudience, input: {userId: string; actor?: ViewerTokenActor}, now = Date.now()): IssuedViewerToken {
  if (!ID.test(input.userId)) throw new Error('invalid_user');
  const artifactId = input.actor?.artifactId ?? null, fn = input.actor?.function ?? null;
  if ((artifactId !== null && !ID.test(artifactId)) || (fn !== null && !FUNCTION.test(fn))) throw new Error('invalid_actor');
  const iat = Math.floor(now / 1000), exp = iat + VIEWER_TOKEN_TTL_SECONDS;
  const claims: ViewerClaims = {sub: input.userId, aud: service.origin, svc: service.id, iat, exp, jti: `vtk_${randomUUID()}`, act: {artifact_id: artifactId, function: fn}};
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return {token: `${VIEWER_TOKEN_PREFIX}${body}.${mac(key, body)}`, audience: service.origin, expiresAt: new Date(exp * 1000).toISOString()};
}

/** Is `token` shaped like a viewer token at all (so introspection takes this path, never the bearer read's)? */
export const isViewerToken = (token: string): boolean => token.startsWith(VIEWER_TOKEN_PREFIX);

/** The claims of a valid, unexpired viewer token for a configured audience, or null. Never throws on input. */
export function verifyViewerToken(key: Buffer, audiences: readonly ServiceAudience[], token: string, now = Date.now()): ViewerClaims | null {
  if (!isViewerToken(token) || token.length > 2048) return null;
  const [body, signature, extra] = token.slice(VIEWER_TOKEN_PREFIX.length).split('.');
  if (!body || !signature || extra !== undefined) return null;
  const expected = Buffer.from(mac(key, body)), given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  let c: ViewerClaims;
  try { c = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ViewerClaims; } catch { return null; }
  const nowS = Math.floor(now / 1000);
  if (!c || typeof c !== 'object' || typeof c.sub !== 'string' || !ID.test(c.sub) || typeof c.aud !== 'string' || typeof c.svc !== 'string' || typeof c.jti !== 'string'
    || !Number.isSafeInteger(c.iat) || !Number.isSafeInteger(c.exp) || c.exp - c.iat > VIEWER_TOKEN_TTL_SECONDS || c.iat > nowS + SKEW_S || c.exp <= nowS
    || !c.act || typeof c.act !== 'object') return null;
  if (!audiences.some(service => service.id === c.svc && service.origin === c.aud)) return null;
  return c;
}

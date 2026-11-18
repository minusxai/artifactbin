/**
 * EXCHANGED SERVICE TOKENS (contracts ./service-audiences `SERVICE_TOKEN_PATH`): "act as this person at that service",
 * issued to a person who already holds a credential here (an access token or a browser session) and verified by
 * introspection, here and nowhere else.
 *
 * REPRESENTATION: the signed token format (./signed-tokens), `vwt_<claims>.<mac>` under a key derived from AUTH__SECRET
 * for this purpose alone. One HMAC to mint and one to verify, no row written and none to sweep; the introspection that
 * verifies it also reads the account's `active` and the parent credential's `live`, so signing out, revoking the parent
 * or deactivating the account ends it on the next check. The format never matches an access token's (`TOKEN_RE`), so
 * the bearer read refuses it before hashing: it cannot be used at this installation's API.
 *
 * Claims and their check are the format's; a service token lives SERVICE_TOKEN_TTL_SECONDS.
 */
import {SERVICE_TOKEN_TTL_SECONDS,type IssuedServiceToken,type ServiceAudience,type ServiceTokenParent} from '@artifactbin/contracts';
import {signToken,signedTokenKey,verifyToken,type SignedTokenClaims,type SignedTokenKind} from './signed-tokens';

const SERVICE_TOKEN: SignedTokenKind = {prefix: 'vwt_', keyInfo: 'identity-viewer-token', ttlSeconds: SERVICE_TOKEN_TTL_SECONDS};

/** The verified claims of a service token. */
export type ServiceTokenClaims = SignedTokenClaims;

/** The signing key, derived from the host's secret for service tokens only (a cookie or another use never shares it). */
export const serviceTokenKey = (secret: string): Buffer => signedTokenKey(SERVICE_TOKEN, secret);

/** A token for `service`, for `userId`'s own credential `parent`. */
export const signServiceToken = (key: Buffer, service: ServiceAudience, input: {userId: string; parent: ServiceTokenParent}, now = Date.now()): IssuedServiceToken =>
  signToken(SERVICE_TOKEN, key, service, input, now);

/** Is `token` shaped like a service token at all (so introspection takes this path, never the bearer read's)? */
export const isServiceToken = (token: string): boolean => token.startsWith(SERVICE_TOKEN.prefix);

/** The claims of a valid, unexpired service token for a configured audience, or null. Never throws on input. */
export const verifyServiceToken = (key: Buffer, audiences: readonly ServiceAudience[], token: string, now = Date.now()): ServiceTokenClaims | null =>
  verifyToken(SERVICE_TOKEN, key, audiences, token, now);

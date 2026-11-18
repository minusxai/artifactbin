/** Domain-separated purpose-only grants (the signed token format, ./signed-tokens); identity checks parent liveness on every use. */
import {type IssuedServiceToken,type ServiceAudience,type ServiceTokenParent} from '@artifactbin/contracts';
import {signToken,signedTokenKey,verifyToken,type SignedTokenClaims,type SignedTokenKind} from './signed-tokens';

/** `arg_` tokens, keyed for artifact read grants alone, for an hour. Never accepted as a general API bearer. */
const ARTIFACT_READ_GRANT: SignedTokenKind = {prefix: 'arg_', keyInfo: 'identity-artifact-read-grant', ttlSeconds: 3600};

/** The verified claims of a artifact read grant. */
export type ArtifactReadClaims = SignedTokenClaims;

/** The signing key, derived from the host's secret for artifact read grants only (a cookie or another use never shares it). */
export const artifactReadKey = (secret: string): Buffer => signedTokenKey(ARTIFACT_READ_GRANT, secret);

/** A token for `service`, for `userId`'s own credential `parent`. */
export const signArtifactReadGrant = (key: Buffer, service: ServiceAudience, input: {userId: string; parent: ServiceTokenParent}, now = Date.now()): IssuedServiceToken =>
  signToken(ARTIFACT_READ_GRANT, key, service, input, now);

/** The claims of a valid, unexpired artifact read grant for a configured audience, or null. Never throws on input. */
export const verifyArtifactReadGrant = (key: Buffer, audiences: readonly ServiceAudience[], token: string, now = Date.now()): ArtifactReadClaims | null =>
  verifyToken(ARTIFACT_READ_GRANT, key, audiences, token, now);

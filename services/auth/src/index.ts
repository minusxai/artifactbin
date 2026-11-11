export {bearerAdmission,authParts,createAuthHost,session,loginRoutes,oauthRoutes,internalBoundary,type SessionStore,type SessionInfo} from './parts';
export {ensureAuthSchema} from './schema';
export {createBearerReader} from './identity/bearer';
export { createHumanAuth, ensureHumanAuthSchema, type HumanAuth, type OutgoingMail } from './auth/human';
export { resendMailer, mailerForRuntime } from './mail';
export {authEnvNamesRead,readEnv} from './env';
export {mailSettingsOf,admissionPolicyOf,loginProvidersOf,testDomainSignInOf,type LoginProviders} from './config';
import type { HumanAuth } from './auth/human';
import type { SessionStore } from './parts';

/** Better Auth as the parts see it — the one adapter between HumanAuth's shape and AuthOptions.sessions. */
export const sessionStoreOf = (h: HumanAuth): SessionStore => ({
  live: (sessionId,userId) => h.sessions.live(sessionId,userId),
  resolve: (request) => h.sessions.resolve(request),
  ...(h.sessions.identity ? {identity: h.sessions.identity.bind(h.sessions)} : {}),
  handler: (request) => h.handler(request),
});
export {IdentityNotReady,ensureIdentitySchema,identityDbOf,identityMoveStatements} from './identity-store';

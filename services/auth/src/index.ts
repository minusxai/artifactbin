export {authParts,createAuthHost,session,loginRoutes,oauthRoutes,internalBoundary,publicBuildAssets,type AuthOptions,type AuthApp,type AuthEnv,type SessionStore,type SessionInfo} from './parts';
export {AUTH_TABLES,ensureAuthSchema} from './schema';
export { createHumanAuth, humanAuthOptions, type HumanAuth, type HumanAuthOptions, type BetterAuthOptions, type Mailer, type OutgoingMail } from './auth/human';
export {
  resendMailer, devOutboxMailer, mailerForRuntime, usesDevOutbox,
  DEV_OUTBOX_RELATIVE_PATH, DEV_OUTBOX_DEFAULT_PATH, MailNotConfigured, MailSendFailed,
} from './mail';
export {authEnvNamesRead,readEnv} from './env';
export {loginProvidersOf,type LoginProviders} from './config';
import type { HumanAuth } from './auth/human';
import type { SessionStore } from './parts';

/** Better Auth as the parts see it — the one adapter between HumanAuth's shape and AuthOptions.sessions. */
export const sessionStoreOf = (h: HumanAuth): SessionStore => ({
  resolve: (request) => h.sessions.resolve(request),
  ...(h.sessions.identity ? {identity: h.sessions.identity.bind(h.sessions)} : {}),
  handler: (request) => h.handler(request),
});

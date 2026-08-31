/**
 * THE OSS PROXY — the parts literal (src/parts.ts) assembled. The authenticating,
 * rate-limiting, login-serving, OAuth-providing forwarder in front of the app:
 * it never answers 401 itself (absent or invalid credential → the app decides),
 * and its only own verdict is a door's 429.
 *
 * `createProxy` is pure of transport: `upstream` is the ONE seam — in-process
 * (utils `inProcess`, the actor riding the Request) or over HTTP (utils
 * `overHttp`, a signed header).
 */
/** The proxy's public surface: the parts literal and what composes it. */
export {
  proxyParts, createProxy, forward, forwardedHeaders, session, rateLimit, loginRoutes, oauthRoutes,
  doorFor, clientIpOf, peerIpOf, trustedHopsOf,
  type ProxyOptions, type SessionStore, type SessionInfo,
} from './parts';
export { PROXY_TABLES, ensureProxySchema } from './schema';
export { createHumanAuth, humanAuthOptions, type HumanAuth, type HumanAuthOptions, type BetterAuthOptions, type Mailer, type OutgoingMail } from './auth/human';
export { resendMailer, MailNotConfigured, MailSendFailed } from './mail';
export { proxyEnvNamesRead, readEnv } from './env';
export { loginProvidersOf, loadConfig, loadProcessConfig, type LoginProviders, type LoadConfigOptions, type ProxyConfig } from './config';
export {
  createStandaloneProxy, humanAuthOptionsFor, buildDeps, runStandalone,
  type StandaloneDeps, type BuiltDeps, type StandaloneOverrides, type RunningProxy,
} from './standalone';
import type { HumanAuth } from './auth/human';
import type { SessionStore } from './parts';

/** Better Auth as the parts see it — the one adapter between HumanAuth's shape and ProxyOptions.sessions. */
export const sessionStoreOf = (h: HumanAuth): SessionStore => ({
  resolve: (request) => h.sessions.resolve(request),
  handler: (request) => h.handler(request),
});

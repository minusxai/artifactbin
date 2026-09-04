/**
 * THE PROXY'S ONE ENV READ — `loadConfig` turns a source object (the process
 * environment in production, a literal in tests) into ONE validated,
 * eagerly-read config. The package never touches `process.env` anywhere
 * else; `loadProcessConfig` below is that single door.
 *
 * Required names throw AT BOOT naming themselves (utils `must`):
 *   APP__UPSTREAM_URL      where the app this proxy fronts lives
 *   CONTRACT__ACTOR_SECRET signs the actor header on the HTTP hop to it
 *
 * Optional: APP__PORT (3000) · APP__HOST · DATABASE_URL (the identity
 * database — without it the proxy boots SESSION-LESS: no login handler, no
 * OAuth state, no token reads; resolve-and-forward only) · AUTH__SECRET ·
 * AUTH__SCHEMA (auth) · APP__SCHEMA (app — the deployment truth in
 * SCHEMA.sql: the app's tables, `tokens` included, live there) ·
 * APP__PUBLIC_BASE_URL · EMAIL__RESEND_API_KEY / EMAIL__FROM (the production
 * login mailer) · EMAIL__DEV_OUTBOX_PATH (local/test process coordination) ·
 * PROXY__SECURE_COOKIES · EVENTS__SERVICE_URL + INTERNAL__SERVICE_SECRET (the
 * log the proxy says its own moments into; unset = nothing leaves the box).
 *
 * Every optional name is read EAGERLY here so the audit is honest: a
 * MODULE__NAME-shaped name nobody asked for is a typo that looks live, and
 * `unknownNames` says so at boot (utils createEnv). RATE_LIMITER__<DOOR>_*
 * are read by PREFIX in the parts (doorsEnv), so the prefix — not each
 * spelled name — is what the audit knows.
 */
import { randomBytes } from 'node:crypto';
import { createEnv } from '@artifactbin/utils';
import type { OidcProvider } from './auth/human';
import { readEnv } from './env';

const LOGIN_PROVIDER_ENV_NAMES = {
  googleClientId: 'AUTH__GOOGLE_CLIENT_ID',
  googleClientSecret: 'AUTH__GOOGLE_CLIENT_SECRET',
  oidcProviderId: 'AUTH__OIDC_PROVIDER_ID',
  oidcClientId: 'AUTH__OIDC_CLIENT_ID',
  oidcClientSecret: 'AUTH__OIDC_CLIENT_SECRET',
  oidcAuthorizationUrl: 'AUTH__OIDC_AUTHORIZATION_URL',
  oidcTokenUrl: 'AUTH__OIDC_TOKEN_URL',
  oidcUserInfoUrl: 'AUTH__OIDC_USERINFO_URL',
  oidcDiscoveryUrl: 'AUTH__OIDC_DISCOVERY_URL',
} as const;
const LOGIN_PROVIDER_ENV_NAME_SET = new Set<string>(Object.values(LOGIN_PROVIDER_ENV_NAMES));

export interface ProxyMailConfig {
  /** EMAIL__RESEND_API_KEY — absent means the mailer refuses to send (no log-the-code fallback). */
  apiKey?: string;
  /** EMAIL__DEV_OUTBOX_PATH — local/test only; public origins always use Resend. */
  devOutboxPath?: string;
  /** EMAIL__FROM. */
  from: string;
}

/** The whole boot decision, made once — nothing downstream reads env again. */
export interface ProxyConfig {
  /** APP__PORT — the port this process serves on. */
  port: number;
  /** APP__HOST — bind one interface; unset binds all of them. */
  host?: string;
  /** APP__UPSTREAM_URL — e.g. http://artifactbin-app:3000. */
  upstreamUrl: string;
  /** CONTRACT__ACTOR_SECRET. */
  actorSecret: string;
  /** DATABASE_URL — the identity database; unset boots session-less. */
  databaseUrl?: string;
  /** AUTH__SECRET — login sessions and the agent cookie. Generated per boot when unset (flagged). */
  authSecret: string;
  /** True when AUTH__SECRET was absent and the secret will not survive a restart. */
  authSecretGenerated: boolean;
  /** AUTH__SCHEMA — where identity's tables live. */
  authSchema: string;
  /** APP__SCHEMA — where the app-owned tokens table lives. */
  appSchema: string;
  /** APP__PUBLIC_BASE_URL — the URL humans reach this proxy on; login's baseURL. */
  publicBaseUrl?: string;
  /** EMAIL__*. */
  mail: ProxyMailConfig;
  /** Cookies carry Secure. */
  secure: boolean;
  /** The raw source, handed to the parts (their doors read RATE_LIMITER__<DOOR>_* by prefix). */
  env: Record<string, string | undefined>;
  /** MODULE__NAME names set but read by nothing — a typo that looks live. */
  unknownNames: string[];
  /** How long the forwarder waits for the upstream's HANDSHAKE (status line + headers) before answering 502. `UPSTREAM__DEADLINE_MS`, default 30_000. The clock never covers a body that streams. */
  upstreamDeadlineMs: number;
  /** Google as a social login, when both `AUTH__GOOGLE_CLIENT_ID` and `AUTH__GOOGLE_CLIENT_SECRET` are set. */
  google?: LoginProviders['google'];
  /** Any OIDC IdP, when `AUTH__OIDC_PROVIDER_ID` is set (the `AUTH__OIDC_*` names). */
  oidc?: OidcProvider;
  /** EVENTS__SERVICE_URL — where the proxy's own sentences go (the events service); unset = nothing leaves the box. */
  eventsServiceUrl?: string;
  /** INTERNAL__SERVICE_SECRET — the header the events service demands; the same secret the app carries. */
  internalServiceSecret?: string;
}

/** The human-login providers a deployment configures beside the email code — the SAME names the co-hosted server reads. */
export interface LoginProviders {
  google?: { clientId: string; clientSecret: string };
  oidc?: OidcProvider;
}

/**
 * THE one reader of the login-provider names: `AUTH__GOOGLE_CLIENT_ID` + `AUTH__GOOGLE_CLIENT_SECRET` (both, or no
 * Google), and `AUTH__OIDC_PROVIDER_ID` with `AUTH__OIDC_{CLIENT_ID,CLIENT_SECRET,AUTHORIZATION_URL,TOKEN_URL,USERINFO_URL,
 * DISCOVERY_URL}` (the id, or no OIDC). Reads through the env audit (`readEnv`) so nothing lands in `unknownNames`. Used
 * by `loadConfig` (standalone) and by the co-hosted `server.ts` — the literal reads live nowhere else.
 */
export function loginProvidersOf(source: Record<string, string | undefined>): LoginProviders {
  const googleClientId = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.googleClientId);
  const googleClientSecret = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.googleClientSecret);
  const oidcProviderId = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcProviderId);
  const oidcClientId = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcClientId);
  const oidcClientSecret = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcClientSecret);
  const oidcAuthorizationUrl = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcAuthorizationUrl);
  const oidcTokenUrl = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcTokenUrl);
  const oidcUserInfoUrl = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcUserInfoUrl);
  const oidcDiscoveryUrl = readEnv(source, LOGIN_PROVIDER_ENV_NAMES.oidcDiscoveryUrl);
  return {
    ...(googleClientId && googleClientSecret
      ? { google: { clientId: googleClientId, clientSecret: googleClientSecret } }
      : {}),
    ...(oidcProviderId ? {
      oidc: {
        providerId: oidcProviderId,
        clientId: oidcClientId ?? '',
        clientSecret: oidcClientSecret ?? '',
        authorizationUrl: oidcAuthorizationUrl,
        tokenUrl: oidcTokenUrl,
        userInfoUrl: oidcUserInfoUrl,
        discoveryUrl: oidcDiscoveryUrl,
      },
    } : {}),
  };
}

/** What a deployment demands of its environment beyond the OSS minimum. */
export interface LoadConfigOptions {
  /**
   * Names that must be set and non-empty for THIS deployment to boot — e.g. a host that refuses to run
   * session-less lists `DATABASE_URL`. A missing one is a boot refusal whose message names EVERY missing
   * name at once (one round-trip to a complete .env), never the first only. Plain names, exactly as they
   * appear in the environment (`DATABASE_URL`, `APP__PUBLIC_BASE_URL`).
   */
  required?: readonly string[];
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on']);

export function loadConfig(source: Record<string, string | undefined>, opts: LoadConfigOptions = {}): ProxyConfig {
  const missing = [...new Set(opts.required ?? [])].filter((name) => {
    const value = source[name];
    return value === undefined || value.trim() === '';
  });
  if (missing.length) throw new Error(`Required environment names are missing or empty: ${missing.join(', ')}`);
  const { env, must, unknownNames } = createEnv(source, { consumedByPrefix: ['RATE_LIMITER__'] });
  const loginProviders = loginProvidersOf(source);
  const upstreamUrl = must('APP', 'UPSTREAM_URL');
  const actorSecret = must('CONTRACT', 'ACTOR_SECRET');
  // Eager, every optional name — the audit is only honest if nothing is read lazily.
  const portRaw = env('APP', 'PORT');
  const parsedPort = Number(portRaw);
  const port = portRaw !== undefined && portRaw.trim() !== '' && Number.isInteger(parsedPort) && parsedPort >= 0 && parsedPort <= 65_535
    ? parsedPort
    : 3000;
  const host = env('APP', 'HOST') || undefined;
  const publicBaseUrl = env('APP', 'PUBLIC_BASE_URL') || undefined;
  const authSchema = env('AUTH', 'SCHEMA') || 'auth';
  const appSchema = env('APP', 'SCHEMA') || 'app';
  const mail = {
    ...(env('EMAIL', 'RESEND_API_KEY') ? { apiKey: env('EMAIL', 'RESEND_API_KEY') } : {}),
    ...(env('EMAIL', 'DEV_OUTBOX_PATH') ? { devOutboxPath: env('EMAIL', 'DEV_OUTBOX_PATH') } : {}),
    from: env('EMAIL', 'FROM') || 'artifactbin <login@example.com>',
  };
  const secureRaw = env('PROXY', 'SECURE_COOKIES') || '';
  const secure = TRUTHY.has(secureRaw.toLowerCase()) || !!publicBaseUrl?.startsWith('https://');
  const authSecretGiven = env('AUTH', 'SECRET') || '';
  // Same stance as the co-hosted server: unset is a dev-only convenience that
  // says so — every browser's held tokens and sessions forget it on restart.
  const authSecret = authSecretGiven || randomBytes(32).toString('base64url');
  const deadlineRaw = env('UPSTREAM', 'DEADLINE_MS');
  const parsedDeadline = Number(deadlineRaw);
  const upstreamDeadlineMs = deadlineRaw !== undefined && Number.isFinite(parsedDeadline) && parsedDeadline > 0
    ? Math.trunc(parsedDeadline)
    : 30_000;
  // The log the proxy speaks into, and the header that service demands. Both
  // are SHARED names — the app carries the same two — read here so the audit
  // never calls them unknown on a proxy that is configured correctly.
  const eventsServiceUrl = env('EVENTS', 'SERVICE_URL') || undefined;
  const internalServiceSecret = env('INTERNAL', 'SERVICE_SECRET') || undefined;
  // A conventional exception (DATABASE_URL/S3_URL) — no MODULE__NAME shape,
  // so it is read straight from the source and audited by nobody.
  const databaseUrl = source.DATABASE_URL || undefined;
  return {
    port,
    ...(host ? { host } : {}),
    upstreamUrl,
    actorSecret,
    ...(databaseUrl ? { databaseUrl } : {}),
    authSecret,
    authSecretGenerated: !authSecretGiven,
    authSchema,
    appSchema,
    ...(publicBaseUrl ? { publicBaseUrl } : {}),
    mail,
    secure,
    env: source,
    unknownNames: unknownNames().filter((name) => !LOGIN_PROVIDER_ENV_NAME_SET.has(name)),
    upstreamDeadlineMs,
    ...(eventsServiceUrl ? { eventsServiceUrl } : {}),
    ...(internalServiceSecret ? { internalServiceSecret } : {}),
    ...loginProviders,
  };
}

/** The one place this package reads the process environment. */
export function loadProcessConfig(opts: LoadConfigOptions = {}): ProxyConfig {
  return loadConfig(process.env, opts);
}

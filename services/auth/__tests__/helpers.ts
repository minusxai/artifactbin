import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { ensureTokensTable, resetTables, testDb } from '@artifactbin/test-support/db';
import { ensureAuthSchema } from '../src/schema';
import { ensureHumanAuthSchema, type HumanAuth } from '../src/auth/human';
import { createBearerReader } from '../src/identity/bearer';
import { createAuthHost, type AuthOptions } from '../src/parts';

export { mintTestToken, testDb } from '@artifactbin/test-support/db';

/** The token reader that knows no bearer token. */
export const noTokens = { byToken: async () => null };
/** The auth host a test builds directly: cookie secret `test`, no bearer tokens and no sessions unless `options` names
 * its own (a session store, a bearer reader, another secret); `options` gives the rest. */
export const serviceAuthHost = (options: Omit<AuthOptions, 'cookieSecret' | 'tokens' | 'sessions'> & Partial<Pick<AuthOptions, 'cookieSecret' | 'tokens' | 'sessions'>>) =>
  createAuthHost({ cookieSecret: 'test', tokens: noTokens, sessions: { resolve: async () => null }, ...options });

/** A delegated service as tests name it: its id, origin and the digest of the secret it presents. */
export const delegatedService = (id: string, origin: string, secret: string) => ({ id, origin, introspectionSecretSha256: createHash('sha256').update(secret).digest('hex') });
type DelegatedService = ReturnType<typeof delegatedService>;
/** The `IDENTITY__SERVICE_AUDIENCES` value that admits `services`, each with any other settings it carries (`artifact_reads`, say). */
export const serviceAudiences = (...services: Array<DelegatedService & Record<string, unknown>>) =>
  JSON.stringify(services.map(({ id, origin, introspectionSecretSha256, ...settings }) => ({ id, origin, introspection_secret_sha256: introspectionSecretSha256, ...settings })));

/**
 * One-time-code sign-in through the caller's own `post` (path and JSON body in, the handler's Response out): ask for a
 * code for `email`, then sign in with what `code()` reads from the captured mail. `prefix` goes before both paths
 * (`/api/auth` when `post` takes the full path). The two responses and the session cookie, for the caller to assert on.
 */
export async function otpSignIn(post: (path: string, body: unknown) => Response | Promise<Response>, email: string, code: () => string | Promise<string>, { prefix = '' } = {}) {
  const sent = await post(`${prefix}/email-otp/send-verification-otp`, { email, type: 'sign-in' });
  const login = await post(`${prefix}/sign-in/email-otp`, { email, otp: await code() });
  return { sent, login, cookie: login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ') };
}

/** Sign `email` in on a human auth by one-time code (`latestOtp` reads what its mail sender last captured): the session cookie header. */
export async function signInByOtp(auth: HumanAuth, baseURL: string, email: string, latestOtp: () => string): Promise<string> {
  const call = (path: string, body: unknown) => auth.handler(new Request(`${baseURL}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseURL }, body: JSON.stringify(body) }));
  const { sent, login, cookie } = await otpSignIn(call, email, latestOtp);
  expect(sent.status).toBe(200);
  expect(login.status).toBe(200);
  return cookie;
}

/** Both sides' tables, idempotent — safe to call before anything exists. */
async function ensureTestSchema(): Promise<void> {
  const { pg, query } = testDb();
  await pg().exec('CREATE SCHEMA IF NOT EXISTS auth');
  await ensureTokensTable();
  await ensureAuthSchema({ query }, 'auth');
  // Better Auth's tables: the bearer reader reads the account's identity from auth."user".
  await ensureHumanAuthSchema({ pglite: pg(), schema: 'auth' });
}

/** Wipe both sides' tables so each test starts empty. */
export async function resetTestDb(): Promise<void> {
  await ensureTestSchema();
  await resetTables(['auth.tokens', 'auth.credentials', 'auth.clients']);
}

export async function testAuthOptions(overrides: Partial<AuthOptions> = {}): Promise<AuthOptions> {
  const { query } = testDb();
  await ensureTestSchema();
  return {
    upstream: async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
    env: {},
    tokens: createBearerReader({ db: { query } }),
    sessions: {
      resolve: async () => null,
      handler: async () => new Response('{"ok":true,"fake":"better-auth"}', { headers: { 'content-type': 'application/json' } }),
    },
    cookieSecret: 'test-cookie-secret-00000000000000000000',
    identityDb: { query },
    ...overrides,
  };
}

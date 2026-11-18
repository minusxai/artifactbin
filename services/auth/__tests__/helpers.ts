import { createHash } from 'node:crypto';
import { expect } from 'vitest';
import { ensureTokensTable, resetTables, testDb } from '@artifactbin/test-support/db';
import { ensureAuthSchema } from '../src/schema';
import { ensureHumanAuthSchema, type HumanAuth } from '../src/auth/human';
import { createBearerReader } from '../src/identity/bearer';
import type { AuthOptions } from '../src/parts';

export { mintTestToken, testDb } from '@artifactbin/test-support/db';

/** The token reader that knows no bearer token. */
export const noTokens = { byToken: async () => null };

/** A delegated service as tests name it: its id, origin and the digest of the secret it presents. */
export const delegatedService = (id: string, origin: string, secret: string) => ({ id, origin, introspectionSecretSha256: createHash('sha256').update(secret).digest('hex') });
/** The `IDENTITY__SERVICE_AUDIENCES` value that admits one such service, with or without artifact reads. */
export const audiencesOf = (service: ReturnType<typeof delegatedService>, artifactReads = true) =>
  JSON.stringify([{ id: service.id, origin: service.origin, introspection_secret_sha256: service.introspectionSecretSha256, artifact_reads: artifactReads }]);

/** Sign `email` in on a human auth by one-time code (`latestOtp` reads what its mail sender last captured): the session cookie header. */
export async function signInByOtp(auth: HumanAuth, baseURL: string, email: string, latestOtp: () => string): Promise<string> {
  const call = (path: string, body: unknown) => auth.handler(new Request(`${baseURL}/api/auth${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: baseURL }, body: JSON.stringify(body) }));
  expect((await call('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
  const login = await call('/sign-in/email-otp', { email, otp: latestOtp() });
  expect(login.status).toBe(200);
  return login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
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

import { ensureTokensTable, resetTables, testDb } from '@artifactbin/test-support/db';
import { ensureAuthSchema } from '../src/schema';
import { ensureHumanAuthSchema } from '../src/auth/human';
import { createBearerReader } from '../src/identity/bearer';
import type { AuthOptions } from '../src/parts';

export { mintTestToken, testDb } from '@artifactbin/test-support/db';

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

import { ensureTokensTable, resetTables, testDb } from '@artifactbin/test-support/db';
import { createTokenReader } from '@artifactbin/utils';
import { ensureAuthSchema } from '../src/schema';
import type { AuthOptions } from '../src/parts';

export { mintTestToken, testDb } from '@artifactbin/test-support/db';
export { PAGE_HEADERS } from '@artifactbin/test-support/browser';

/** Both sides' tables, idempotent — safe to call before anything exists. */
export async function ensureTestSchema(): Promise<void> {
  const { pg, query } = testDb();
  await pg().exec('CREATE SCHEMA IF NOT EXISTS auth');
  await ensureTokensTable();
  await ensureAuthSchema({ query }, 'auth');
}

/** Wipe both sides' tables so each test starts empty. */
export async function resetTestDb(): Promise<void> {
  await ensureTestSchema();
  await resetTables(['tokens', 'auth.credentials', 'auth.clients']);
}

export async function testAuthOptions(overrides: Partial<AuthOptions> = {}): Promise<AuthOptions> {
  const { query } = testDb();
  await ensureTestSchema();
  return {
    upstream: async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
    env: {},
    tokens: createTokenReader({ db: { query } }),
    sessions: {
      resolve: async () => null,
      handler: async () => new Response('{"ok":true,"fake":"better-auth"}', { headers: { 'content-type': 'application/json' } }),
    },
    cookieSecret: 'test-cookie-secret-00000000000000000000',
    identityDb: { query },
    ...overrides,
  };
}

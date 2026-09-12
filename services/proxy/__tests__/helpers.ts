/** Shared by the proxy's tests: options over one in-memory PGLite, no secrets, no network.
 *
 * The generic half — the PGLite instance, the app-owned tokens table, the wipe, the minted token row,
 * the recorded page headers — now lives in `@artifactbin/test-support`. What stays here is the part
 * that is the proxy's own: its schema, its policy files, and the options object its parts take.
 */
import path from 'node:path';
import { ensureTokensTable, resetTables, testDb } from '@artifactbin/test-support/db';
import { createTokenReader } from '@artifactbin/utils';
import { ensureProxySchema } from '../src/schema';
import type { ProxyOptions } from '../src/parts';

export { mintTestToken, testDb } from '@artifactbin/test-support/db';
export { PAGE_HEADERS } from '@artifactbin/test-support/browser';

/** Both sides' tables, idempotent — safe to call before anything exists. */
export async function ensureTestSchema(): Promise<void> {
  const { pg, query } = testDb();
  await pg().exec('CREATE SCHEMA IF NOT EXISTS auth');
  await ensureTokensTable();
  await ensureProxySchema({ query }, 'auth');
}

/** Wipe both sides' tables so each test starts empty. */
export async function resetTestDb(): Promise<void> {
  await ensureTestSchema();
  await resetTables(['tokens', 'auth.credentials', 'auth.clients']);
}

/**
 * THE SUITE'S DEFAULT POLICY FILE — the shipped DEV one, whose anonymous mint is wide open, so a test that
 * is not about a rate limit never trips one. A test that IS about a limit names its own fixture
 * (`__tests__/fixtures/*.yml`) through `env: { PROXY__RATE_LIMIT_CONFIG_FILE: … }`.
 */
export const RELAXED_POLICY_FILE = path.resolve(__dirname, '../dev_rate_limits.yml');
/** One fixture by name — `policyFile('mint_1.yml')`. */
export const policyFile = (name: string): string => path.resolve(__dirname, 'fixtures', name);

export async function testProxyOptions(overrides: Partial<ProxyOptions> = {}): Promise<ProxyOptions> {
  const { query } = testDb();
  await ensureTestSchema();
  return {
    upstream: async () => new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }),
    env: { PROXY__RATE_LIMIT_CONFIG_FILE: RELAXED_POLICY_FILE },
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

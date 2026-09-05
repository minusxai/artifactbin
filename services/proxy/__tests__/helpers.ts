/** Shared by the proxy's tests: options over one in-memory PGLite, no secrets, no network. */
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createTokenReader } from '@artifactbin/utils';
import { ensureProxySchema } from '../src/schema';
import type { ProxyOptions } from '../src/parts';

/** One PGLite per process: every test's tables live in it, wiped per use. */
let shared: PGlite | null = null;
export const testDb = () => {
  if (!shared) shared = new PGlite();
  const query = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await shared!.query<T>(sql, params)) as { rows: T[] };
  return { pg: () => shared!, query };
};

/** The app-owned tokens table, as the reader SELECTs it (the app declares it; the proxy only reads). */
const TOKENS_DDL = [
  `CREATE TABLE IF NOT EXISTS tokens (
     id TEXT PRIMARY KEY,
     name TEXT,
     token_hash TEXT NOT NULL,
     user_id TEXT,
     client_harness TEXT,
     audience TEXT,
     scope TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     deleted_at TIMESTAMPTZ,
     expires_at TIMESTAMPTZ,
     last_used_at TIMESTAMPTZ
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_hash ON tokens (token_hash)`,
];

/** Both sides' tables, idempotent — safe to call before anything exists. */
export async function ensureTestSchema(): Promise<void> {
  const { pg, query } = testDb();
  await pg().exec('CREATE SCHEMA IF NOT EXISTS auth');
  for (const stmt of TOKENS_DDL) await pg().exec(stmt);
  await ensureProxySchema({ query }, 'auth');
}

/** Wipe both sides' tables so each test starts empty. */
export async function resetTestDb(): Promise<void> {
  await ensureTestSchema();
  const { pg } = testDb();
  await pg().exec('DELETE FROM tokens; DELETE FROM auth.credentials; DELETE FROM auth.clients');
}

/** A ready token row, answered the way the app would mint it (hash only, never the secret). */
export async function mintTestToken(o: { id: string; userId: string | null; pg: PGlite }): Promise<string> {
  const token = `mx_${o.id.padEnd(40, 'x')}`;
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256').update(token).digest('hex');
  await o.pg.query('INSERT INTO tokens (id, name, token_hash, user_id) VALUES ($1, $2, $3, $4)', [o.id, 'test', hash, o.userId]);
  return token;
}

/**
 * What Chromium actually sends on the `/tokens/new` mint fetch (MEASURED on production). Any test that mints
 * through the composed proxy needs these now: the mint route is `browser_only` in every policy file, and the
 * proxy refuses that ONE path to a non-browser. Kept here rather than typed into each file, so the measured
 * shape has a single home.
 */
export const BROWSER_MINT_HEADERS: Readonly<Record<string, string>> = { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' };

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

/**
 * One PGLite per test process, plus the two things every suite that uses it then needs: a wipe between
 * cases, and a token row shaped the way the app mints one.
 *
 * PGLite owns one serialized connection per process, so a second instance is a second engine and a
 * second few hundred milliseconds of start-up. Callers share this one and reset the tables they touch.
 * Schema creation stays with whoever owns the schema — pass an `ensure` callback; this module knows
 * only the app-owned `tokens` table, because the token reader every service composes SELECTs from it.
 */
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

export interface TestQuery {
  <T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface TestDb {
  pg(): PGlite;
  query: TestQuery;
}

let shared: PGlite | null = null;

/** The process-wide instance, created on first use. */
export const testDb = (): TestDb => {
  if (!shared) shared = new PGlite();
  const query: TestQuery = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await shared!.query<T>(sql, params)) as { rows: T[] };
  return { pg: () => shared!, query };
};

/** The app-owned tokens table, as the reader SELECTs it (the app declares it; readers only read). */
export const TOKENS_DDL: readonly string[] = [
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

/** Idempotent: create the tokens table this package owns. */
export async function ensureTokensTable(): Promise<void> {
  const { pg } = testDb();
  for (const statement of TOKENS_DDL) await pg().exec(statement);
}

/** `DELETE FROM` each table in order, so every case starts empty without paying for a new engine. */
export async function resetTables(tables: readonly string[]): Promise<void> {
  const { pg } = testDb();
  if (tables.length) await pg().exec(tables.map(table => `DELETE FROM ${table};`).join(' '));
}

/** A ready token row, answered the way the app would mint it (hash only, never the secret). */
export async function mintTestToken(o: { id: string; userId: string | null; query: TestQuery }): Promise<string> {
  const token = `mx_${o.id.padEnd(40, 'x')}`;
  const hash = createHash('sha256').update(token).digest('hex');
  await o.query('INSERT INTO tokens (id, name, token_hash, user_id) VALUES ($1, $2, $3, $4)', [o.id, 'test', hash, o.userId]);
  return token;
}

/**
 * THE STORED DATASET POLICY MIGRATION: rewrite every stored dataset's none/v1/v2 policy as v3
 * (lib/document-data/dataset-policy/migrate.ts decides; docs/operations.md says when to run it).
 *
 *   node --import tsx scripts/migrate-dataset-policies.ts [--dry-run | --apply] [--database <url>] [--json <file>] [--limit <n>]
 *
 * - Dry run is the default: one READ ONLY transaction, nothing written. A read-only database role is enough.
 * - `--apply` rewrites one dataset per transaction (idempotent; rerun to resume). `--limit <n>` stops after n.
 * - `--database` defaults to DATABASE_URL (`postgres://…`, or `pglite://<dir>` with the server stopped). No
 *   schema DDL or backfill runs: the script opens its own connection, never the app's boot path.
 * - Prints the human summary; `--json <file>` also writes the machine-readable report. IDs only: no titles,
 *   emails or row data.
 * Exit 0 when every dataset is v3 or planned/migrated, 1 when any dataset was refused or failed, 2 on usage.
 */
import fs from 'node:fs';
import type { MigrationDb } from '@/lib/document-data';

const USAGE = 'usage: node --import tsx scripts/migrate-dataset-policies.ts [--dry-run | --apply] [--database <url>] [--json <file>] [--limit <n>]';

interface Options { apply: boolean; database?: string; json?: string; limit?: number }

function parseArgs(argv: string[], env = process.env): Options & { database: string } {
  const options: Options = { apply: false, database: env.DATABASE_URL };
  let mode: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => { const next = argv[++i]; if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`); return next; };
    if (arg === '--dry-run' || arg === '--apply') { if (mode && mode !== arg) throw new Error('choose one of --dry-run and --apply'); mode = arg; options.apply = arg === '--apply'; }
    else if (arg === '--database') options.database = value();
    else if (arg === '--json') options.json = value();
    else if (arg === '--limit') { const n = Number(value()); if (!Number.isSafeInteger(n) || n < 1) throw new Error('--limit must be a positive integer'); options.limit = n; }
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.database) throw new Error('name the database: --database <url> or DATABASE_URL');
  return { ...options, database: options.database };
}

/** A query/transaction handle on the named database, and how to close it. Nothing else runs on it. */
type Rows = { rows: Record<string, unknown>[] };
type Raw = { query(text: string, params?: unknown[]): Promise<Rows> };

async function open(url: string): Promise<{ db: MigrationDb; close: () => Promise<void> }> {
  if (url.startsWith('pglite://')) {
    const dir = url.slice('pglite://'.length);
    if (!dir || dir === 'memory' || !fs.existsSync(dir)) throw new Error(`no PGLite database at ${dir || '(none)'}`);
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(dir);
    const wrap = (q: Raw) => ({ query: async (text: string, params?: unknown[]) => ({ rows: (await q.query(text, params)).rows }) });
    const handle = { ...wrap(db), transaction: (fn: (tx: Raw) => Promise<unknown>) => db.transaction((tx) => fn(wrap(tx))) };
    return { db: handle as unknown as MigrationDb, close: () => db.close() };
  }
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: url, max: 1, application_name: 'migrate-dataset-policies' });
  const query = async (text: string, params?: unknown[]) => ({ rows: (await pool.query(text, params)).rows });
  const transaction = async (fn: (tx: Raw) => Promise<unknown>) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn({ query: async (text: string, params?: unknown[]) => ({ rows: (await client.query(text, params)).rows }) });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  };
  return { db: { query, transaction } as unknown as MigrationDb, close: () => pool.end() };
}

async function main() {
  let options: ReturnType<typeof parseArgs>;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${(error as Error).message}\n${USAGE}`); process.exit(2); }
  // The app modules read DATABASE_URL at import; this run never opens the app's database, so it cannot reach it by accident.
  delete process.env.DATABASE_URL;
  const { migrateDatasetPolicies, formatMigrationReport } = await import('@/lib/document-data');
  const { db, close } = await open(options.database);
  let report: Awaited<ReturnType<typeof migrateDatasetPolicies>>;
  try { report = await migrateDatasetPolicies(db, { apply: options.apply, ...(options.limit ? { limit: options.limit } : {}) }); } finally { await close(); }
  process.stdout.write(formatMigrationReport(report));
  if (options.json) fs.writeFileSync(options.json, `${JSON.stringify(report, null, 2)}\n`);
  const refused = ['invalid_policy', 'failed', 'changed'].some((outcome) => report.counts.outcome[outcome]);
  process.exit(refused ? 1 : 0);
}

await main();

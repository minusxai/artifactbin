/**
 * THE WEB ASSETS BACKFILL: fill `meta.webAssets` (lib/artifacts web-assets) on every HTML page written before the
 * store derived it, so an owner host answers `/assets/<hash>` from the index instead of reading page sources.
 * An operator script, never the boot path: it opens its own connection and runs no schema DDL.
 *
 *   node --import tsx scripts/backfill-web-assets.ts [--dry-run | --apply] [--database <url>] [--chunk <n>] [--limit <n>]
 *
 * - Dry run is the default: SELECTs only, nothing written. `--apply` writes one UPDATE per chunk (default 200 rows).
 * - Idempotent and resumable: a page that has the key is never read again; a page republished between the read and
 *   the write is left for the next run (listed as changed). Rerun until `remaining=0`.
 * - `--database` defaults to DATABASE_URL (`postgres://…`, or `pglite://<dir>` with the server stopped).
 * - Prints ids and counts only: no titles, sources or URLs.
 * Exit 0 when done (or a dry run / `--limit` run finished), 1 when an apply left pages without the key, 2 on usage.
 *
 * In a production app image (no tsx, read-only root), run the bundle; it carries everything but `pg`, which it
 * loads from the image's /runtime/node_modules:
 *   npx esbuild scripts/backfill-web-assets.ts --bundle --platform=node --format=esm --target=node22 \
 *     --external:pg --external:@electric-sql/pglite --outfile=tmp/backfill-web-assets.mjs
 */
import fs from 'node:fs';
import { backfillWebAssets } from '@/lib/artifacts/web-assets';

const USAGE = 'usage: node --import tsx scripts/backfill-web-assets.ts [--dry-run | --apply] [--database <url>] [--chunk <n>] [--limit <n>]';
type Rows = { rows: Record<string, unknown>[] };
type Raw = { query(text: string, params?: unknown[]): Promise<Rows> };
type Db = { query<T>(text: string, params?: unknown[]): Promise<{ rows: T[] }> };

function parseArgs(argv: string[], env = process.env) {
  const options: { apply: boolean; database?: string; chunk?: number; limit?: number } = { apply: false, database: env.DATABASE_URL };
  let mode: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => { const next = argv[++i]; if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`); return next; };
    const count = () => { const n = Number(value()); if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${arg} must be a positive integer`); return n; };
    if (arg === '--dry-run' || arg === '--apply') { if (mode && mode !== arg) throw new Error('choose one of --dry-run and --apply'); mode = arg; options.apply = arg === '--apply'; }
    else if (arg === '--database') options.database = value();
    else if (arg === '--chunk') options.chunk = count();
    else if (arg === '--limit') options.limit = count();
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.database) throw new Error('name the database: --database <url> or DATABASE_URL');
  return { ...options, database: options.database };
}

/** A query handle on the named database, and how to close it. Nothing else runs on it. */
async function open(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  if (url.startsWith('pglite://')) {
    const dir = url.slice('pglite://'.length);
    if (!dir || dir === 'memory' || !fs.existsSync(dir)) throw new Error(`no PGLite database at ${dir || '(none)'}`);
    const { PGlite } = await import('@electric-sql/pglite');
    const db = new PGlite(dir);
    return { db: { query: async (text, params) => ({ rows: (await (db as Raw).query(text, params)).rows as never[] }) }, close: () => db.close() };
  }
  const pg = (await import('pg')).default;
  const pool = new pg.Pool({ connectionString: url, max: 1, application_name: 'backfill-web-assets' });
  return { db: { query: async (text, params) => ({ rows: (await pool.query(text, params)).rows }) }, close: () => pool.end() };
}

async function main() {
  let options: ReturnType<typeof parseArgs>;
  try { options = parseArgs(process.argv.slice(2)); } catch (error) { console.error(`${(error as Error).message}\n${USAGE}`); process.exit(2); }
  const { db, close } = await open(options.database);
  let report: Awaited<ReturnType<typeof backfillWebAssets>>;
  try {
    report = await backfillWebAssets(db, { apply: options.apply, chunk: options.chunk, limit: options.limit, onChunk: (line) => console.log(line) });
  } finally { await close(); }
  console.log(`web assets backfill (${report.mode}): scanned=${report.scanned} ${options.apply ? 'written' : 'planned'}=${report.written} with_assets=${report.withAssets} changed=${report.changed.length} remaining=${report.remaining}`);
  if (report.changed.length) console.log(`changed (rerun): ${report.changed.join(',')}`);
  process.exit(options.apply && !options.limit && report.remaining > 0 ? 1 : 0);
}

await main();

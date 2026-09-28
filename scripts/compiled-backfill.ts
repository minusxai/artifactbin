/**
 * THE COMPILED-PAGE BACKFILL (services/app/lib/compiled-page/backfill.server): every live document
 * head — with `--all`, every archived version too — gets its compiled page stored, so the first reader
 * after a deploy is served a stored compile instead of paying for one.
 *
 *   AUTH__SECRET=<the server's> npx tsx scripts/compiled-backfill.ts --db <database url> --base <server origin>
 *     [--all] [--concurrency 3] [--limit N] [--timeout 180] [--dry-run]
 *
 * From the repository root, against a RUNNING server of the deploy being backfilled. The script only
 * decides what to warm: each version is prepared and compiled by that server, through its own reader
 * door (`/a/<id>/raw?reader=compiled`, admitted by a one-minute export key), because a stored prepared
 * page is keyed by the serving process's own build and a compile made here would be a miss there.
 *
 * Preconditions, each of which the run checks or states:
 *  - `--db` (or `DATABASE_URL`) is the server's database: the targets and the census are read there.
 *  - `AUTH__SECRET` is the server's own secret (environment only, never an argument): the export keys
 *    are minted under it. The script refuses to run without it.
 *  - `--base` (or `APP__PUBLIC_BASE_URL`) reaches that server. On its host, the loopback address
 *    (`http://127.0.0.1:<APP__PORT>`) skips the proxy; an unknown host falls through to the app.
 *  - The server's `FLAG__COMPILED_READER` is `shadow` or `on`: with `off` it compiles nothing, and the
 *    first request says so (`x-mx-reader: legacy` with no reason) — the run stops there.
 *  - No object-store settings are needed here: the server writes the module bytes.
 *
 * On the production host, after a deploy has rolled out (the new server is the one answering):
 *
 *   1. `--dry-run` first: how many versions, and roughly how many a previous run already stored.
 *   2. Heads: the command above with `--concurrency 3`. Idempotent: a version this deployment already
 *      stored (its prepared-page key ends with this deployment's suffix) is skipped, so an interrupted
 *      run is resumed by running it again, and a second run warms only its probe.
 *   3. Optionally `--all` for archived versions (read by their editors only; each in its own slot).
 *
 * The last line is the census from the database: versions stored by this deployment, compiled, and
 * recorded failures by reason (`compile-error`, `unported` — both expected to be 0). Exit status 1 when
 * any request failed or any failure is recorded.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: 'string' }, base: { type: 'string' }, all: { type: 'boolean' }, concurrency: { type: 'string' },
    limit: { type: 'string' }, timeout: { type: 'string' }, 'dry-run': { type: 'boolean' },
  } });
  const usage = 'usage: AUTH__SECRET=<the server\'s> compiled-backfill.ts --db <url> --base <server origin> [--all] [--concurrency 3] [--limit N] [--timeout 180] [--dry-run]';
  const db = values.db ?? process.env.DATABASE_URL;
  const base = values.base ?? process.env.APP__PUBLIC_BASE_URL;
  if (!db || !base) throw new Error(usage);
  if (!process.env.AUTH__SECRET) throw new Error(`AUTH__SECRET is not set: the export keys must be minted under the server's own secret.\n${usage}`);
  process.env.DATABASE_URL = db;
  // After the environment is set: lib/config reads it on first import.
  const [{ getDb }, { mintExportKey }, { backfillCompiledPages }] = await Promise.all([
    import('@/lib/db'), import('@/lib/export-key'), import('@/lib/compiled-page/backfill.server'),
  ]);
  const database = await getDb();
  try {
    const report = await backfillCompiledPages({
      db: database, base, fetch: (url, init) => fetch(url, init), mintKey: (id) => mintExportKey(id),
      all: !!values.all, dryRun: !!values['dry-run'],
      ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
      ...(values.limit ? { limit: Number(values.limit) } : {}),
      ...(values.timeout ? { timeoutMs: Number(values.timeout) * 1000 } : {}),
      log: (line) => console.log(line),
    });
    if (values['dry-run']) return;
    const fallbacks = Object.entries(report.fallbacks).map(([reason, n]) => `${reason} ${n}`).join(', ') || 'none';
    console.log(`warmed ${report.warmed} of ${report.considered} version(s) (${report.done} already stored): ${report.compiled} compiled, fallbacks ${fallbacks}, ${report.errors.length} error(s)`);
    for (const e of report.errors.slice(0, 20)) console.log(`  error ${e.id}${e.head ? '' : ` v${e.version}`}: ${e.error}`);
    const census = report.census!;
    const failures = Object.entries(census.failures).map(([reason, n]) => `${reason} ${n}`).join(', ') || 'none';
    console.log(`census (build ${report.build}): ${census.stored} stored by this deployment, ${census.compiled} compiled, failures ${failures}, ${census.missing} not stored`);
    if (report.errors.length || Object.keys(census.failures).length) process.exitCode = 1;
  } finally {
    await database.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

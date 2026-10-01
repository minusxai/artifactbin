/**
 * THE COMPILED-PAGE BACKFILL (services/app/lib/compiled-page/backfill.server): deliberately recompile
 * selected document versions on the running server. A deploy alone never changes stored compiles.
 *
 *   AUTH__SECRET=<the server's> npx tsx scripts/compiled-backfill.ts --db <database url> --base <server origin>
 *     [--all] [--stale] [--where compiler_version!=<fingerprint>] [--island-build <id>]
 *     [--format-below N] [--concurrency 3] [--limit N] [--timeout 180] [--dry-run]
 *
 * From the repository root, against a RUNNING server of the deploy being backfilled. The script only
 * decides what to warm: each version is prepared and compiled by that server, through its own reader
 * door (`/a/<id>/raw`, admitted by a one-minute export key), because a stored prepared
 * page is compiled by the serving process, with its own assets and compiler fingerprint.
 *
 * Preconditions, each of which the run checks or states:
 *  - `--db` (or `DATABASE_URL`) is the server's database: the targets and the census are read there.
 *  - `AUTH__SECRET` is the server's own secret (environment only, never an argument): the export keys
 *    are minted under it. The script refuses to run without it.
 *  - `--base` (or `APP__PUBLIC_BASE_URL`) reaches that server. On its host, the loopback address
 *    (`http://127.0.0.1:<APP__PORT>`) skips the proxy; an unknown host falls through to the app.
 *  - No object-store settings are needed here: the server writes the module bytes.
 *
 * On the production host, after a deploy has rolled out (the new server is the one answering):
 *
 *   0. A deploy needs NO backfill: stored pages bind the live shared runtime at serve time, and a page
 *      below a raised MIN_HANDOVER_CONTRACT is served on its own retained build while it recompiles in
 *      the background on its first read; a page prepared under an older stylesheet (css_version) is
 *      re-prepared in the background the same way. `--stale` upgrades both ahead of readers.
 *   1. Pick a recorded version: `--where compiler_version!=<current>` selects old compilers;
 *      `--island-build <old>` selects one island build; `--format-below N` selects old formats.
 *      Filters combine with AND. Without filters, only versions lacking a compile are selected.
 *   2. Run `--dry-run`, then rerun without it. Repeat after interruption: rows that no longer match
 *      the filter are skipped. Use `--all` to include archived versions.
 *
 * The last line is the census from the database: selected versions stored, compiled, and
 * recorded failures by reason (`compile-error`, `unported` — both expected to be 0). Exit status 1 when
 * any request failed or any failure is recorded.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { BackfillFilter, BackfillColumn, BackfillSelector } from '@/lib/compiled-page/backfill.server';
import { MIN_HANDOVER_CONTRACT } from '@/lib/compiled-page/contract';

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: 'string' }, base: { type: 'string' }, all: { type: 'boolean' }, concurrency: { type: 'string' },
    limit: { type: 'string' }, timeout: { type: 'string' }, 'dry-run': { type: 'boolean' },
    where: { type: 'string' }, stale: { type: 'boolean' }, 'island-build': { type: 'string' }, 'format-below': { type: 'string' },
  } });
  const usage = 'usage: AUTH__SECRET=<the server\'s> compiled-backfill.ts --db <url> --base <server origin> [--all] [--stale] [--where compiler_version!=<x>] [--island-build <id>] [--format-below N] [--concurrency 3] [--limit N] [--timeout 180] [--dry-run]';
  const db = values.db ?? process.env.DATABASE_URL;
  const base = values.base ?? process.env.APP__PUBLIC_BASE_URL;
  if (!db || !base) throw new Error(usage);
  if (!process.env.AUTH__SECRET) throw new Error(`AUTH__SECRET is not set: the export keys must be minted under the server's own secret.\n${usage}`);
  const filters: BackfillSelector[] = [];
  if (values.where) {
    const match = /^(compiler_version|island_build|css_version|ssr_bundle|page_format|handover_contract)(!=|=|<)([\w.-]+)$/.exec(values.where);
    if (!match) throw new Error(`invalid --where: ${values.where}\n${usage}`);
    const column = match[1] as BackfillColumn;
    filters.push({ column, op: match[2] as BackfillFilter['op'], value: column === 'page_format' || column === 'handover_contract' ? Number(match[3]) : match[3]! });
  }
  // The runtime binds live at serve time, so only a raised contract or format, or an older stored stylesheet, makes a stored page stale.
  if (values['island-build']) filters.push({ column: 'island_build', op: '=', value: values['island-build'] });
  if (values['format-below']) filters.push({ column: 'page_format', op: '<', value: Number(values['format-below']) });
  process.env.DATABASE_URL = db;
  // After the environment is set, as every server module here: an old contract OR an older stored stylesheet.
  if (values.stale) {
    const { preparedCssVersion } = await import('@/lib/story/prepared/css-version.server');
    filters.unshift({ any: [{ column: 'handover_contract', op: '<', value: MIN_HANDOVER_CONTRACT }, { column: 'css_version', op: '!=', value: preparedCssVersion() }] });
  }
  // After the environment is set: lib/config reads it on first import.
  const [{ getDb }, { mintExportKey }, { backfillCompiledPages }] = await Promise.all([
    import('@/lib/platform/db'), import('@/lib/serving/export-read-key'), import('@/lib/compiled-page/backfill.server'),
  ]);
  const database = await getDb();
  try {
    const report = await backfillCompiledPages({
      db: database, base, fetch: (url, init) => fetch(url, init), mintKey: (id) => mintExportKey(id),
      all: !!values.all, dryRun: !!values['dry-run'], filters,
      ...(values.concurrency ? { concurrency: Number(values.concurrency) } : {}),
      ...(values.limit ? { limit: Number(values.limit) } : {}),
      ...(values.timeout ? { timeoutMs: Number(values.timeout) * 1000 } : {}),
      log: (line) => console.log(line),
    });
    if (values['dry-run']) {
      console.log(`dry run: ${report.considered} version(s) selected, ${report.done} skipped; nothing warmed`);
      return;
    }
    if (!report.considered) { console.log('no live document versions: nothing to warm'); return; }
    console.log(`warmed ${report.warmed} of ${report.considered} version(s) (${report.done} already stored): ${report.compiled} compiled, ${report.errors.length} error(s)`);
    for (const e of report.errors.slice(0, 20)) console.log(`  error ${e.id}${e.head ? '' : ` v${e.version}`}: ${e.error}`);
    const census = report.census!;
    const failures = Object.entries(census.failures).map(([reason, n]) => `${reason} ${n}`).join(', ') || 'none';
    console.log(`census: ${census.stored} selected versions stored, ${census.compiled} compiled, failures ${failures}, ${census.missing} not stored`);
    if (report.errors.length || Object.keys(census.failures).length) process.exitCode = 1;
  } finally {
    await database.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

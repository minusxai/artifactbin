/**
 * THE AUTHOR-SCRIPT AUDIT (services/app/lib/publish/prepared/script-audit.server): which live documents' CURRENT head
 * carries a Helmet `<script>` that no longer builds with this checkout's builder — a version stored before an API
 * change (an export removed from `page`), which readers are served without its script.
 *
 *   npx tsx scripts/audit-author-scripts.ts --db <database url> [--json] [--batch 200]
 *
 * From the repository root, with the checkout of the deploy being audited (its builder is the one judged).
 * `--db` (or `DATABASE_URL`) is read exactly as the server and scripts/compiled-backfill.ts read it
 * (lib/platform/database-url): a `postgres://…` URL carries its own TLS settings (`sslmode=…`, `sslrootcert=…`), a
 * `pglite://<dir>` names a PGLite data directory (dev; stop the dev server first — PGLite is one process's alone),
 * and none means the app's own `data/pglite`.
 *
 * STRICTLY READ-ONLY: it opens ONE connection of its own (never the server's boot path, which writes its schema),
 * makes that session read-only (`SET default_transaction_read_only = on`, confirmed before any read) and only reads.
 * It needs no server, no `AUTH__SECRET` and no object store.
 *
 * Output: one line per failure, `id, visibility, version, error` (the builder's messages joined by ` | `), then the
 * totals; `--json` prints the report as one JSON object instead. Exit status 1 when any script does not build.
 * A failing document is fixed by republishing it with a script that builds; until then its page says so.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Queryable } from '@artifactbin/contracts';

/** The one connection, by the engine the URL names; closed by `close`. */
async function connect(url: string | undefined): Promise<{ db: Queryable; close: () => Promise<void> }> {
  const { databaseTargetForRuntime } = await import('@/lib/platform/db');
  const target = databaseTargetForRuntime(url);
  if (target.engine === 'pg') {
    const pg = await import('pg');
    const client = new pg.Client({ connectionString: target.url });
    await client.connect();
    return { db: client, close: () => client.end() };
  }
  const { PGlite } = await import('@electric-sql/pglite');
  if (!target.dataDir) throw new Error('an in-memory PGLite holds no documents: name a data directory (pglite://<dir>)');
  const lite = new PGlite(target.dataDir);
  await lite.waitReady;
  return { db: lite, close: () => lite.close() };
}

async function main() {
  const { values } = parseArgs({ options: { db: { type: 'string' }, json: { type: 'boolean' }, batch: { type: 'string' } } });
  const url = values.db ?? process.env.DATABASE_URL;
  // Before any app module loads: lib/config reads the environment on first import.
  if (url) process.env.DATABASE_URL = url;
  const { openReadOnly, auditAuthorScripts, formatScriptAudit } = await import('@/lib/publish/prepared/script-audit.server');
  const { db, close } = await connect(url);
  let failing = 0;
  try {
    const report = await auditAuthorScripts(await openReadOnly(db), values.batch ? { batch: Number(values.batch) } : {});
    console.log(formatScriptAudit(report, { json: !!values.json }));
    failing = report.failures.length;
  } finally {
    await close();
  }
  // After closing: PGLite's runtime resets the exit code as it shuts down.
  if (failing) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

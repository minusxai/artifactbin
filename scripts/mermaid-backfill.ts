/**
 * QUEUE THE MERMAID BACKFILL (lib/mermaid-images/store queueMermaidBackfill):
 * every live document head that may draw a `<Mermaid>` and has no harvest for
 * the current engine gets one queued, newest first. Idempotent — a second run
 * queues nothing new — and it only writes queue rows: the RUNNING app's
 * harvester drains them one version at a time through its own browser, so run
 * this where the app's database is reachable and leave the app running.
 *
 *   npx tsx scripts/mermaid-backfill.ts --db <database url> [--limit 1000] [--retry-failed] [--dry-run]
 *
 * From the repository root. `--dry-run` counts what it would queue and changes
 * nothing. Readers queue the versions they read anyway; this reaches the rest.
 */
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

async function main() {
  const { values } = parseArgs({ options: { db: { type: 'string' }, limit: { type: 'string' }, 'retry-failed': { type: 'boolean' }, 'dry-run': { type: 'boolean' } } });
  if (!values.db) throw new Error('usage: mermaid-backfill.ts --db <url> [--limit 1000] [--retry-failed] [--dry-run]');
  process.env.DATABASE_URL = values.db;
  // After the environment is set: lib/config reads it on first import.
  const [{ getDb }, { queueMermaidBackfill }] = await Promise.all([import('@/lib/platform/db'), import('@/lib/mermaid-images/store')]);
  const db = await getDb();
  try {
    const dryRun = !!values['dry-run'];
    const result = await queueMermaidBackfill(db, { limit: values.limit ? Number(values.limit) : undefined, retryFailed: !!values['retry-failed'], dryRun });
    console.log(`${dryRun ? 'dry run: would queue' : 'queued'} ${result.queued} document version(s)${values['retry-failed'] ? `, ${dryRun ? 'would retry' : 'retried'} ${result.retried} failed harvest(s)` : ''}`);
  } finally {
    await db.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

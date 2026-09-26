/**
 * RUN THE SQLITE DATA-SYNTAX MIGRATION to the end (lib/sqlite-syntax-migration),
 * one bounded batch after another, and report every document it passed:
 *
 *   npx tsx scripts/migrate/sqlite/run-migration.ts --db <database url> [--objects <object dir> | --live-objects] [--dry-run] [--batch 100] [--out <report.jsonl>]
 *
 * `--live-objects` is the production run: datasets are read from the object
 * store the environment's S3_URL names. Without it nothing leaves this machine.
 *
 * From the repository root. The report is JSON lines, one outcome per
 * document, appended as each batch commits — so an interrupted run resumes
 * from the job's durable cursor and the file still holds every earlier
 * outcome. It is compare-results.ts's `--map`. A dry run writes nothing to the
 * database, starts from the job's cursor, and replaces its own report file.
 * The conflicts — documents left for a person — are printed at the end, from
 * the whole report.
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import type { Db } from '@/lib/db';
import type { SqliteSyntaxMigrationOutcome } from '@/lib/sqlite-syntax-migration';
import { useLocalServices } from './local-services';

type Migration = typeof import('@/lib/sqlite-syntax-migration');

/** Batches until done, handing each batch's outcomes to `record`. */
export async function runMigration(
  db: Db,
  runBatch: Migration['runSqliteSyntaxMigrationBatch'],
  options: { batchSize: number; dryRun: boolean },
  record: (outcomes: SqliteSyntaxMigrationOutcome[]) => void,
): Promise<{ batches: number; documents: number }> {
  let after: string | null | undefined;
  let batches = 0, documents = 0;
  for (;;) {
    const report = await runBatch(db, { batchSize: options.batchSize, dryRun: options.dryRun, ...(options.dryRun && after !== undefined ? { after } : {}) });
    batches++;
    documents += report.documents.length;
    record(report.documents);
    if (report.done) return { batches, documents };
    after = report.cursor;
  }
}

/** The documents left for a person, by the last outcome the report gives each. */
export function conflictReport(outcomes: SqliteSyntaxMigrationOutcome[]): string {
  const last = new Map(outcomes.map((outcome) => [outcome.artifactId, outcome]));
  const conflicts = [...last.values()].filter((outcome) => outcome.outcome === 'conflict');
  const counts = new Map<string, number>();
  for (const outcome of last.values()) counts.set(outcome.outcome, (counts.get(outcome.outcome) ?? 0) + 1);
  const lines = conflicts.flatMap((conflict) => [
    `${conflict.artifactId}`,
    ...(conflict.manual ?? []).map((item) => `  manual${item.declaration ? ` ${item.declaration}` : ''} [${item.start}-${item.end}]: ${item.reason}`),
    ...(conflict.refused ?? []).map((reason) => `  refused: ${reason}`),
  ]);
  lines.push(`documents ${last.size}: ${['converted', 'unchanged', 'current', 'conflict'].map((kind) => `${kind} ${counts.get(kind) ?? 0}`).join(', ')}`);
  return lines.join('\n');
}

async function main() {
  const { values } = parseArgs({ options: {
    db: { type: 'string' }, objects: { type: 'string' }, 'live-objects': { type: 'boolean' }, 'dry-run': { type: 'boolean' }, batch: { type: 'string' }, out: { type: 'string' },
  } });
  if (!values.db) throw new Error('usage: run-migration.ts --db <url> [--objects <dir>] [--dry-run] [--batch 100] [--out <report.jsonl>]');
  const dryRun = !!values['dry-run'];
  const out = values.out ?? (dryRun ? 'sqlite-syntax-migration.dry-run.jsonl' : 'sqlite-syntax-migration.jsonl');
  await useLocalServices({ db: values.db, objects: values.objects, liveObjects: !!values['live-objects'] });
  // After the environment is set: lib/config reads it on first import.
  const [{ getDb }, { runSqliteSyntaxMigrationBatch }] = await Promise.all([import('@/lib/db'), import('@/lib/sqlite-syntax-migration')]);
  const db = await getDb();
  if (dryRun || !existsSync(out)) writeFileSync(out, '');
  const summary = await runMigration(db, runSqliteSyntaxMigrationBatch, { batchSize: Number(values.batch ?? 100), dryRun }, (outcomes) => {
    if (outcomes.length) appendFileSync(out, outcomes.map((outcome) => `${JSON.stringify(outcome)}\n`).join(''));
    process.stderr.write(`.${outcomes.length}`);
  });
  await db.close();
  const all = readFileSync(out, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as SqliteSyntaxMigrationOutcome);
  console.log(`\n${dryRun ? 'dry run: ' : ''}${summary.documents} documents in ${summary.batches} batches → ${out}`);
  console.log(conflictReport(all));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();

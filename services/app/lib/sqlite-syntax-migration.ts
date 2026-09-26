import { artifactQuery } from '@/lib/artifact-document';
/**
 * App-owned, resumable migration of every stored document to the SQLite data
 * syntax (lib/story/data-syntax), in the shape of lib/node-identity-migration.
 *
 * Server-side maintenance code passes its exclusively owned Db; this module
 * never calls getDb itself (the publish preparation it shares with ordinary
 * writes does). One invocation owns one bounded batch; the operator repeats it
 * until `done` (scripts/migrate/sqlite/run-migration).
 *
 * Unlike the identity backfill, a document that needs a person does not hold
 * the cursor: it is reported with its reasons, left untouched and unmarked,
 * and the job moves on — a production archive has too many of those for the
 * job to stop at each. Every outcome is in the report, so the operator's
 * record of conflicts is the reports, not a second pass.
 */
import { commitNormalizedMarkup, publishMarkupForArtifact, type ArtifactRow, type PreparedMarkupWrite } from './artifacts';
import type { Db, Queryable } from './db';
import { convertStoredDocument } from './migrate/sqlite/stored';
import type { ConversionChange, ConversionManual } from './migrate/sqlite/convert';
import { DATA_SYNTAX_META } from './story/data-syntax';

const SQLITE_SYNTAX_MIGRATION = 'sqlite-data-syntax';
const SQLITE_SYNTAX_MIGRATION_VERSION = 1;

interface SqliteSyntaxMigrationOptions {
  /** Integer in [1, 100]. */
  batchSize: number;
  dryRun?: boolean;
  /** Dry run only: continue after this id. A dry run never moves the stored cursor, so a looping operator passes the last report's. */
  after?: string | null;
  /** Test-only seam, after a document is prepared and before its transaction: a concurrent writer. */
  beforeCommit?: (artifactId: string) => Promise<void>;
  /** Test-only rollback barrier, after artifact writes but before cursor update/commit. */
  failBeforeCommit?: () => void;
}

export interface SqliteSyntaxMigrationOutcome {
  artifactId: string;
  /**
   * `converted`: a new version in the current syntax. `unchanged`: nothing to
   * convert, marked in place. `current`: already marked, skipped. `conflict`:
   * left untouched, with `manual` or `refused` saying why.
   */
  outcome: 'converted' | 'unchanged' | 'current' | 'conflict';
  /** The version the migration wrote (`converted`, not in a dry run). */
  version?: number;
  changes?: ConversionChange[];
  /** What needs a person, with offsets into the document's source. */
  manual?: ConversionManual[];
  /** Why the converted source did not publish. */
  refused?: string[];
}

interface SqliteSyntaxMigrationReport {
  name: typeof SQLITE_SYNTAX_MIGRATION;
  version: typeof SQLITE_SYNTAX_MIGRATION_VERSION;
  cursor: string | null;
  processed: number;
  /** Every document this batch passed, in id order. */
  documents: SqliteSyntaxMigrationOutcome[];
  done: boolean;
  dryRun: boolean;
}

type Prepared = { outcome: SqliteSyntaxMigrationOutcome; published?: PreparedMarkupWrite };

/**
 * Lock order is migration job row, then the artifact row. A document's new
 * version (with its archive, node identity and edit log, through the ordinary
 * publish preparation and commit), its marker and the cursor commit together;
 * a head that moved since preparation is prepared again.
 */
export async function runSqliteSyntaxMigrationBatch(db: Db, options: SqliteSyntaxMigrationOptions): Promise<SqliteSyntaxMigrationReport> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 100) {
    throw new Error('sqlite-syntax-migration: batchSize must be an integer from 1 through 100');
  }
  const dryRun = !!options.dryRun;
  const initialJob = await db.query<{ version: number; cursor: string | null; completed_at: string | null }>(
    'SELECT version,cursor,completed_at FROM node_identity_migration_jobs WHERE name=$1', [SQLITE_SYNTAX_MIGRATION],
  );
  const stored = initialJob.rows[0];
  if (stored && stored.version !== SQLITE_SYNTAX_MIGRATION_VERSION) {
    throw new Error(`sqlite-syntax-migration: unsupported stored version ${stored.version}`);
  }
  let cursor = dryRun && options.after !== undefined ? options.after : stored?.cursor ?? null;
  if (stored?.completed_at && !dryRun) return report(cursor, [], true, false);
  const documents: SqliteSyntaxMigrationOutcome[] = [];
  let contentionRetries = 0;

  while (documents.length < options.batchSize) {
    const current = (await artifactQuery<ArtifactRow>(db,
      "SELECT * FROM artifacts WHERE format='markup' AND id > COALESCE($1,'') ORDER BY id LIMIT 1", [cursor],
    )).rows[0];
    if (!current) break;
    const prepared = await prepareArtifact(db, current, dryRun);
    if (dryRun) { documents.push(prepared.outcome); cursor = current.id; continue; }
    await options.beforeCommit?.(current.id);
    const committed = await db.transaction(async (tx) => {
      await tx.query(
        'INSERT INTO node_identity_migration_jobs (name,version,cursor) VALUES ($1,$2,NULL) ON CONFLICT (name) DO NOTHING',
        [SQLITE_SYNTAX_MIGRATION, SQLITE_SYNTAX_MIGRATION_VERSION],
      );
      const job = (await tx.query<{ version: number; cursor: string | null; completed_at: string | null }>(
        'SELECT version,cursor,completed_at FROM node_identity_migration_jobs WHERE name=$1 FOR UPDATE', [SQLITE_SYNTAX_MIGRATION],
      )).rows[0];
      if (job.version !== SQLITE_SYNTAX_MIGRATION_VERSION) throw new Error(`sqlite-syntax-migration: unsupported stored version ${job.version}`);
      if (job.cursor !== cursor || job.completed_at) return false;
      const locked = (await artifactQuery<ArtifactRow>(tx, 'SELECT * FROM artifacts WHERE id=$1 FOR UPDATE', [current.id])).rows[0];
      if (!locked || locked.edit_id !== current.edit_id || locked.source !== current.source) return false;
      const outcome = await commitArtifact(tx, locked, prepared);
      options.failBeforeCommit?.();
      const more = (await tx.query("SELECT 1 FROM artifacts WHERE format='markup' AND id>$1 LIMIT 1", [current.id])).rows.length > 0;
      await tx.query(
        `UPDATE node_identity_migration_jobs SET cursor=$2,completed_at=${more ? 'NULL' : 'now()'},updated_at=now() WHERE name=$1`,
        [SQLITE_SYNTAX_MIGRATION, current.id],
      );
      return { outcome, done: !more };
    });
    if (!committed) {
      if (++contentionRetries >= 3) throw new Error('sqlite-syntax-migration: concurrent cursor/head changes exceeded retry limit');
      const live = await db.query<{ cursor: string | null; completed_at: string | null }>('SELECT cursor,completed_at FROM node_identity_migration_jobs WHERE name=$1', [SQLITE_SYNTAX_MIGRATION]);
      cursor = live.rows[0]?.cursor ?? null;
      if (live.rows[0]?.completed_at) return report(cursor, documents, true, false);
      continue;
    }
    contentionRetries = 0;
    documents.push(committed.outcome);
    cursor = current.id;
    if (committed.done) return report(cursor, documents, true, false);
  }
  const more = (await db.query("SELECT 1 FROM artifacts WHERE format='markup' AND id>COALESCE($1,'') LIMIT 1", [cursor])).rows.length > 0;
  if (!more && !dryRun && documents.length === 0) {
    await db.transaction(async (tx) => {
      await tx.query('INSERT INTO node_identity_migration_jobs (name,version,cursor) VALUES ($1,$2,$3) ON CONFLICT (name) DO NOTHING',
        [SQLITE_SYNTAX_MIGRATION, SQLITE_SYNTAX_MIGRATION_VERSION, cursor]);
      await tx.query('UPDATE node_identity_migration_jobs SET completed_at=now(),updated_at=now() WHERE name=$1 AND version=$2 AND cursor IS NOT DISTINCT FROM $3',
        [SQLITE_SYNTAX_MIGRATION, SQLITE_SYNTAX_MIGRATION_VERSION, cursor]);
    });
  }
  return report(cursor, documents, !more, dryRun);
}

/** Convert outside the transaction: the publish preparation reads DB-backed refs through its own connection. */
async function prepareArtifact(db: Queryable, current: ArtifactRow, dryRun: boolean): Promise<Prepared> {
  const artifactId = current.id;
  const conversion = await convertStoredDocument(db, { ...current, source: current.source ?? '' });
  if (conversion.status === 'current') return { outcome: { artifactId, outcome: 'current' } };
  const { changes, manual } = conversion;
  if (conversion.status === 'manual') return { outcome: { artifactId, outcome: 'conflict', changes, manual } };
  if (conversion.status === 'unchanged') return { outcome: { artifactId, outcome: 'unchanged' } };
  if (dryRun) return { outcome: { artifactId, outcome: 'converted', changes } };
  const published = await publishMarkupForArtifact(current, conversion.source);
  if (published instanceof Response) return { outcome: { artifactId, outcome: 'conflict', changes, refused: await refusal(published) } };
  return { outcome: { artifactId, outcome: 'converted', changes }, published };
}

async function commitArtifact(tx: Queryable, locked: ArtifactRow, prepared: Prepared): Promise<SqliteSyntaxMigrationOutcome> {
  const { outcome, published } = prepared;
  if (outcome.outcome === 'unchanged') {
    await tx.query('UPDATE artifacts SET meta=meta||$2::jsonb WHERE id=$1', [locked.id, JSON.stringify(DATA_SYNTAX_META)]);
  }
  if (outcome.outcome !== 'converted' || !published) return outcome;
  // A whole write, so the publish path marks it. Authored by no actor, like
  // every maintenance write; the version says which job wrote it.
  const row = await commitNormalizedMarkup(tx, null, locked, published);
  await tx.query('UPDATE artifacts SET meta=meta||$2::jsonb WHERE id=$1', [row.id, JSON.stringify({ dataSyntaxMigration: { job: SQLITE_SYNTAX_MIGRATION, from: locked.version, version: row.version } })]);
  return { ...outcome, version: row.version };
}

async function refusal(response: Response): Promise<string[]> {
  const body = await response.json().catch(() => null) as { error?: string; details?: unknown } | null;
  const details = Array.isArray(body?.details) ? body.details.map(String) : [];
  return [`${response.status} ${body?.error ?? 'refused'}`, ...details];
}

function report(cursor: string | null, documents: SqliteSyntaxMigrationOutcome[], done: boolean, dryRun: boolean): SqliteSyntaxMigrationReport {
  return { name: SQLITE_SYNTAX_MIGRATION, version: SQLITE_SYNTAX_MIGRATION_VERSION, cursor, processed: documents.length, documents, done, dryRun };
}

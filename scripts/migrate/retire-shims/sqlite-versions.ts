/**
 * ARCHIVED VERSIONS AND TRASHED HEADS TO THE SQLITE DATA SYNTAX (`meta.dataSyntax: 2`).
 *
 *   DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/sqlite-versions.ts [--apply]
 *
 * The data-syntax migration (lib/artifacts/sqlite-syntax-migration) converts live
 * heads through the publish door and passes trashed ones over; versions are never
 * converted in place. This writes the same conversion — the migration's own
 * converter, lib/migrate/sqlite/stored convertStoredDocument — in place, for
 * both. A row the converter cannot carry over without a person (`manual`) is
 * never touched: it is listed, and its count decides whether
 * lib/migrate/sqlite can be deleted at all.
 *
 * In place, because neither can go through the publish door: an archived
 * version is history, and a trashed head cannot be written through it. So the
 * row keeps its `version`, `edit_id` and `deleted_at`; its source is replaced
 * by the converted one (stored as a graph, `source` NULL, exactly as the lazy
 * representation migration in lib/artifacts/document writes archives) and its
 * meta gains the marker and a `dataSyntaxMigration` stamp. Converted bytes
 * carry no new node ids until the document is next published; that is the same
 * source `inCurrentSyntax` serves for them today.
 */
import { artifactQuery } from '@/lib/artifacts/document';
import { createDocumentGraph } from '@/lib/story/graph/document-graph';
import { parseJsx } from '@/lib/jsx';
import { convertStoredDocument } from '@/lib/migrate/sqlite/stored';
import { DATA_SYNTAX_META, hasCurrentDataSyntax } from '@/lib/story/data/data-syntax';
import { isMain, newReport, recordChange, runCli, type BackfillOptions, type BackfillReport } from './common';
import type { Db } from '@/lib/platform/db';

const UNMARKED = `NOT meta @> '{"dataSyntax":2}'::jsonb`;
const JOB = 'retire-shims:sqlite-versions';

interface Row { id: string; version: number; edit_id: string | null; source: string | null; document: unknown; meta: Record<string, unknown>; user_id: string | null; token_id: string }

type Scope = 'trashed head' | 'version';

const SCOPES: Array<{ scope: Scope; keys: string; fetch: string; lock: string; write: string; writeMeta: string }> = [
  {
    scope: 'trashed head',
    keys: `SELECT id, version FROM artifacts WHERE format='markup' AND deleted_at IS NOT NULL AND ${UNMARKED} ORDER BY id`,
    fetch: 'SELECT id, version, edit_id, source, document, meta, user_id, token_id FROM artifacts WHERE id=$1 AND version=$2',
    lock: 'SELECT id, version, edit_id, source, document, meta, user_id, token_id FROM artifacts WHERE id=$1 AND version=$2 AND deleted_at IS NOT NULL FOR UPDATE',
    write: 'UPDATE artifacts SET document=$3::jsonb, source=NULL, meta=meta||$4::jsonb WHERE id=$1 AND version=$2 AND deleted_at IS NOT NULL',
    writeMeta: 'UPDATE artifacts SET meta=meta||$3::jsonb WHERE id=$1 AND version=$2 AND deleted_at IS NOT NULL',
  },
  {
    scope: 'version',
    keys: `SELECT artifact_id AS id, version FROM artifact_versions WHERE format='markup' AND ${UNMARKED} ORDER BY artifact_id, version`,
    fetch: `SELECT v.artifact_id AS id, v.version, NULL::text AS edit_id, v.source, v.document, v.meta, a.user_id, a.token_id
            FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id WHERE v.artifact_id=$1 AND v.version=$2`,
    lock: `SELECT v.artifact_id AS id, v.version, NULL::text AS edit_id, v.source, v.document, v.meta, a.user_id, a.token_id
           FROM artifact_versions v JOIN artifacts a ON a.id=v.artifact_id WHERE v.artifact_id=$1 AND v.version=$2 FOR UPDATE OF v`,
    write: 'UPDATE artifact_versions SET document=$3::jsonb, source=NULL, meta=meta||$4::jsonb WHERE artifact_id=$1 AND version=$2',
    writeMeta: 'UPDATE artifact_versions SET meta=meta||$3::jsonb WHERE artifact_id=$1 AND version=$2',
  },
];

type Plan =
  | { kind: 'skip' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'mark' }
  | { kind: 'convert'; graph: string };

async function plan(db: Db, row: Row): Promise<Plan> {
  if (hasCurrentDataSyntax(row.meta)) return { kind: 'skip' };
  const conversion = await convertStoredDocument(db, { source: row.source ?? '', meta: row.meta, user_id: row.user_id, token_id: row.token_id });
  if (conversion.status === 'current') return { kind: 'skip' };
  if (conversion.status === 'manual') {
    return { kind: 'blocked', reason: `needs a person: ${conversion.manual.map((item) => `${item.declaration ?? 'document'} (${item.reason})`).join('; ')}` };
  }
  if (conversion.status === 'unchanged') return { kind: 'mark' };
  if (!parseJsx(conversion.source).ok) return { kind: 'blocked', reason: 'the converted source does not parse' };
  try {
    return { kind: 'convert', graph: JSON.stringify(createDocumentGraph(conversion.source, row.version, { preserveSource: true })) };
  } catch (error) {
    return { kind: 'blocked', reason: `the converted source has no document graph: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export async function run(db: Db, options: BackfillOptions): Promise<BackfillReport> {
  const report = newReport('sqlite-versions', options);
  const outcomes = new Map<string, number>();
  const count = (scope: Scope, outcome: string) => outcomes.set(`${scope} ${outcome}`, (outcomes.get(`${scope} ${outcome}`) ?? 0) + 1);
  for (const spec of SCOPES) {
    const keys = (await db.query<{ id: string; version: number }>(spec.keys)).rows;
    report.candidates += keys.length;
    for (const key of keys) {
      const label = spec.scope === 'version' ? `${key.id}@${key.version}` : key.id;
      const row = (await artifactQuery<Row>(db, spec.fetch, [key.id, key.version])).rows[0];
      if (!row) continue;
      // Prepared outside the transaction: the converter reads referenced datasets on this handle.
      const planned = await plan(db, row);
      if (planned.kind === 'skip') continue;
      if (planned.kind === 'blocked') { report.blocked.push({ id: label, reason: planned.reason }); count(spec.scope, 'manual'); continue; }
      count(spec.scope, planned.kind === 'mark' ? 'unchanged' : 'converted');
      if (options.apply) {
        const written = await db.transaction(async (tx) => {
          const locked = (await artifactQuery<Row>(tx, spec.lock, [key.id, key.version])).rows[0];
          // Re-check under the lock: the row may have been converted, restored or edited since it was prepared.
          if (!locked || locked.source !== row.source || hasCurrentDataSyntax(locked.meta)) return false;
          const stamp = JSON.stringify({ ...DATA_SYNTAX_META, dataSyntaxMigration: { job: JOB, from: row.version } });
          if (planned.kind === 'convert') await tx.query(spec.write, [key.id, key.version, planned.graph, stamp]);
          else await tx.query(spec.writeMeta, [key.id, key.version, stamp]);
          return true;
        });
        if (!written) continue;
      }
      recordChange(report, options, label);
    }
  }
  report.notes.push(...[...outcomes].sort().map(([name, n]) => `${name}: ${n}`));
  report.notes.push(report.blocked.length
    ? `UNLOCKS NOTHING YET: ${report.blocked.length} row(s) need a person; lib/migrate/sqlite must stay until they are converted by hand`
    : 'no row needs a person: with live heads already marked, lib/migrate/sqlite and the lazy conversion can be deleted after this --apply');
  return report;
}

if (isMain(import.meta.url)) await runCli('sqlite-versions', run);

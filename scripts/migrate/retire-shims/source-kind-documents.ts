/**
 * STORED DOCUMENTS THAT ARE NOT YET A GRAPH (`document.kind` other than `graph`), eagerly.
 *
 *   DATABASE_URL=<url> npx tsx scripts/migrate/retire-shims/source-kind-documents.ts [--apply]
 *
 * lib/artifacts/document loadArtifactDocument migrates a source/semantic/jsx
 * document to the graph lazily, on first read. This runs that same function on
 * every such row, so the write is the one production already makes (a
 * compare-and-set UPDATE that keeps the version, and `source` NULL). An archive
 * whose bytes do not parse can never become a graph: the lazy path stores it
 * back as `kind: source`, and so does this — such a row is reported as blocked,
 * and while one exists the `source` branch of decodeDocument stays.
 *
 * The notes count the rows still stored as `semantic`, `jsx` or in the legacy
 * `source` column (production: 0 of each), which is what lets those decode
 * branches go.
 */
import { loadArtifactDocument } from '@/lib/artifacts/document';
import { parseJsx } from '@/lib/jsx';
import { decodeDocument, type StoredDocument } from '@/lib/story/document/document-codec';
import { isMain, newReport, recordChange, runCli, type BackfillOptions, type BackfillReport } from './common';
import type { Db } from '@/lib/platform/db';

const NOT_GRAPH = `format='markup' AND ((document IS NOT NULL AND document <> 'null'::jsonb) OR source IS NOT NULL) AND COALESCE(document->>'kind','<null>') <> 'graph'`;

interface Row { id: string; version: number; kind: string; source: string | null; document: StoredDocument | null }

export async function run(db: Db, options: BackfillOptions): Promise<BackfillReport> {
  const report = newReport('source-kind-documents', options);
  const kinds = new Map<string, number>();
  const scopes = [
    {
      scope: 'head',
      sql: `SELECT id, version, COALESCE(document->>'kind','<null>') AS kind, source, document FROM artifacts WHERE ${NOT_GRAPH} ORDER BY id`,
      reload: 'SELECT * FROM artifacts WHERE id=$1 AND version=$2',
    },
    {
      scope: 'version',
      sql: `SELECT artifact_id AS id, version, COALESCE(document->>'kind','<null>') AS kind, source, document FROM artifact_versions WHERE ${NOT_GRAPH} ORDER BY artifact_id, version`,
      reload: 'SELECT * FROM artifact_versions WHERE artifact_id=$1 AND version=$2',
    },
  ] as const;
  for (const spec of scopes) {
    const rows = (await db.query<Row>(spec.sql)).rows;
    report.candidates += rows.length;
    for (const row of rows) {
      const label = spec.scope === 'version' ? `${row.id}@${row.version}` : row.id;
      kinds.set(`${spec.scope} ${row.kind}`, (kinds.get(`${spec.scope} ${row.kind}`) ?? 0) + 1);
      let source: string;
      try {
        source = row.document && row.document.schema ? decodeDocument(row.document) : row.source ?? '';
      } catch (error) {
        report.blocked.push({ id: label, reason: `stored document does not decode: ${error instanceof Error ? error.message : String(error)}` });
        continue;
      }
      if (!parseJsx(source).ok) { report.blocked.push({ id: label, reason: 'the stored bytes do not parse, so they cannot become a graph' }); continue; }
      if (options.apply) {
        const after = await loadArtifactDocument<{ id?: string; artifact_id?: string; format: string; version: number; document?: StoredDocument | null; source?: string | null }>(
          db, spec.reload, [row.id, row.version],
        );
        if (after?.document?.kind !== 'graph') { report.blocked.push({ id: label, reason: 'still not a graph after the lazy migration' }); continue; }
      }
      recordChange(report, options, label);
    }
  }
  report.notes.push(...[...kinds].sort().map(([name, n]) => `${name}: ${n}`));
  const legacy = [...kinds].filter(([name]) => /semantic|jsx|<null>/.test(name)).reduce((sum, [, n]) => sum + n, 0);
  report.notes.push(legacy
    ? `${legacy} row(s) stored as semantic/jsx/source-column: those decodeDocument branches must stay until this is 0`
    : 'no semantic/jsx/source-column rows: those decodeDocument branches can go');
  if (report.blocked.length) report.notes.push(`${report.blocked.length} row(s) cannot become a graph: the kind "source" branch of decodeDocument must stay`);
  return report;
}

if (isMain(import.meta.url)) await runCli('source-kind-documents', run);

/**
 * COMPARE RECORDED RESULTS from before and after the SQLite data-syntax
 * migration (record-results.ts), by document and query name — conversion keeps
 * every declaration's name. Values are compared as the migration's
 * differential check compares them (lib/migrate/sqlite/diff compareTables):
 * column names in order, rows as a multiset of engine-neutral values.
 *
 *   npx tsx scripts/migrate/sqlite/compare-results.ts <before.jsonl> <after.jsonl> --map <migration-report.jsonl> [--rerun <before-again.jsonl> …]
 *
 * `--rerun` (repeatable) is another recording at the before commit: a query
 * the previous engine answered differently on any of them (ties at a LIMIT,
 * rows cut without an order) is `unstable before`, not a difference the
 * migration made.
 * From the repository root. The map is run-migration.ts's report: it says what the migration did to each
 * document, and marks queries whose conversion notes say they read the clock
 * (`$_now`), whose results may differ between two runs for that reason alone.
 * Exits 1 when a document the migration did not leave as a conflict has a
 * query that differs, newly fails, or ran before and not after — the compiled
 * engine records nothing for a document it cannot compile, so a query missing
 * after the migration is a failure, not an absence. Conflicts are listed too,
 * but they are the migration report's to account for.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { compareTables, type TableDifference } from '@/lib/migrate/sqlite/diff';
import type { SqliteSyntaxMigrationOutcome } from '@/lib/sqlite-syntax-migration';
import type { RecordedResult } from './record-results';

/**
 * `cut`: an engine shipped only a window of the result (the previous engine's
 * first page of a `source=` query, either one's display window) and the
 * windows agree — every row of a window is in the other side's whole result,
 * or both are windows of results of one size. `unstable before`: the previous
 * engine itself answered differently on a second run.
 */
type QueryStatus = 'identical' | 'differs' | 'cut' | 'unstable before' | 'failed before' | 'failed after' | 'failed both' | 'only before' | 'only after';

export interface QueryComparison {
  query: string;
  status: QueryStatus;
  /** A compact first difference, or the error(s). */
  detail?: string;
  /** Its conversion reads `$_now`: a difference may be the clock. */
  clock?: true;
}

export interface DocumentComparison {
  document: string;
  /** What the migration did to it; absent when the report does not name it. */
  outcome?: SqliteSyntaxMigrationOutcome['outcome'];
  /** The document itself failed to run, before or after. */
  failed?: { before?: string; after?: string };
  queries: QueryComparison[];
}

export interface Comparison {
  documents: DocumentComparison[];
  totals: Record<QueryStatus, number> & { documents: number; clock: number };
}

type Recorded = { columns: string[]; rows: unknown[][]; truncated?: true; totalRows?: number };
type Side = Map<string, { error?: string; queries: Map<string, Recorded | { error: string }> }>;

/** Whether the difference is only which window of one result each side shipped. */
function onlyTheCut(x: Recorded, y: Recorded, difference: TableDifference): boolean {
  if (difference.columns || (!x.truncated && !y.truncated)) return false;
  if (x.truncated && y.truncated) return x.totalRows !== undefined && x.totalRows === y.totalRows && x.rows.length === y.rows.length;
  const [cut, whole] = x.truncated ? [x, y] : [y, x];
  const within = x.truncated ? !difference.rows!.missing.length : !difference.rows!.extra.length;
  return within && (cut.totalRows === undefined || cut.totalRows === whole.rows.length);
}
const shipped = (r: Recorded) => `${r.rows.length} of ${r.truncated ? r.totalRows ?? '?' : r.rows.length}`;

function bySide(records: RecordedResult[]): Side {
  const side: Side = new Map();
  for (const record of records) {
    const doc: NonNullable<ReturnType<Side['get']>> = side.get(record.document) ?? { queries: new Map() };
    side.set(record.document, doc);
    if (!('query' in record)) doc.error = record.error;
    else doc.queries.set(record.query, 'error' in record ? { error: record.error } : record);
  }
  return side;
}

const table = (recorded: { columns: string[]; rows: unknown[][] }) => ({
  columns: recorded.columns.map((name) => ({ name })),
  rows: recorded.rows.map((row) => Object.fromEntries(recorded.columns.map((name, i) => [name, row[i]]))),
});

const clip = (value: unknown) => { const text = JSON.stringify(value); return text.length > 120 ? `${text.slice(0, 117)}...` : text; };

function firstDifference(difference: TableDifference): string {
  if (difference.columns) return `columns ${clip(difference.columns.original)} → ${clip(difference.columns.translated)}`;
  const { missing, extra } = difference.rows!;
  return [missing.length ? `before only ${clip(missing[0])}` : '', extra.length ? `after only ${clip(extra[0])}` : ''].filter(Boolean).join('; ');
}

/** The last outcome each report line gives a document (a resumed run appends). */
function outcomes(report: SqliteSyntaxMigrationOutcome[]): Map<string, SqliteSyntaxMigrationOutcome> {
  return new Map(report.map((outcome) => [outcome.artifactId, outcome]));
}

export function compareResults(before: RecordedResult[], after: RecordedResult[], report: SqliteSyntaxMigrationOutcome[], reruns: RecordedResult[][] = []): Comparison {
  const a = bySide(before), b = bySide(after), again = reruns.map(bySide), map = outcomes(report);
  const totals: Comparison['totals'] = { documents: 0, clock: 0, identical: 0, differs: 0, cut: 0, 'unstable before': 0, 'failed before': 0, 'failed after': 0, 'failed both': 0, 'only before': 0, 'only after': 0 };
  const documents: DocumentComparison[] = [];
  for (const document of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    const was = a.get(document), now = b.get(document), outcome = map.get(document);
    const clock = new Set((outcome?.changes ?? []).filter((change) => change.notes?.some((note) => note.includes('$_now'))).map((change) => change.declaration));
    const queries: QueryComparison[] = [];
    for (const query of [...new Set([...(was?.queries.keys() ?? []), ...(now?.queries.keys() ?? [])])].sort()) {
      const x = was?.queries.get(query), y = now?.queries.get(query);
      let result: QueryComparison;
      if (!x || !y) result = { query, status: x ? 'only before' : 'only after' };
      else if ('error' in x && 'error' in y) result = { query, status: 'failed both', detail: `${x.error} | ${y.error}` };
      else if ('error' in x) result = { query, status: 'failed before', detail: x.error };
      else if ('error' in y) result = { query, status: 'failed after', detail: y.error };
      else {
        const difference = compareTables(table(x), table(y));
        const cut = difference && onlyTheCut(x, y, difference);
        const unstable = difference && again.some((side) => {
          const second = side.get(document)?.queries.get(query);
          return second && ('error' in second || compareTables(table(x), table(second)));
        });
        result = cut ? { query, status: 'cut', detail: `before shipped ${shipped(x)} rows; after ${shipped(y)}` }
          : unstable ? { query, status: 'unstable before', detail: `the previous engine answered differently on a second run; ${firstDifference(difference)}` }
          : difference ? { query, status: 'differs', detail: firstDifference(difference) } : { query, status: 'identical' };
      }
      if (clock.has(query)) { result.clock = true; totals.clock++; }
      totals[result.status]++;
      queries.push(result);
    }
    const failed = was?.error || now?.error ? { ...(was?.error ? { before: was.error } : {}), ...(now?.error ? { after: now.error } : {}) } : undefined;
    totals.documents++;
    documents.push({ document, ...(outcome ? { outcome: outcome.outcome } : {}), ...(failed ? { failed } : {}), queries });
  }
  return { documents, totals };
}

const REGRESSIONS: QueryStatus[] = ['differs', 'failed after', 'only before'];

/** The documents whose results the migration changed: every one it did not leave for a person. */
export function regressions(comparison: Comparison): DocumentComparison[] {
  return comparison.documents.filter((doc) => doc.outcome !== 'conflict' && (doc.failed?.after || doc.queries.some((q) => REGRESSIONS.includes(q.status))));
}

/** The operator's report: documents with anything but identical results, then totals. */
export function formatComparison(comparison: Comparison): string {
  const lines: string[] = [];
  for (const doc of comparison.documents) {
    const notable = doc.queries.filter((q) => q.status !== 'identical');
    if (!notable.length && !doc.failed) continue;
    lines.push(`${doc.document}  ${doc.outcome ?? 'not in the migration report'}`);
    if (doc.failed?.before) lines.push(`  document failed before: ${doc.failed.before}`);
    if (doc.failed?.after) lines.push(`  document failed after: ${doc.failed.after}`);
    for (const q of notable) lines.push(`  ${q.status.padEnd(13)} ${q.query}${q.clock ? ' (reads the clock)' : ''}${q.detail ? `: ${q.detail}` : ''}`);
  }
  const t = comparison.totals;
  lines.push(`documents ${t.documents}; queries: identical ${t.identical}, differs ${t.differs}, cut ${t.cut}, unstable before ${t['unstable before']}, failed before ${t['failed before']}, failed after ${t['failed after']}, failed both ${t['failed both']}, only before ${t['only before']}, only after ${t['only after']}; reading the clock ${t.clock}`);
  return lines.join('\n');
}

const jsonl = <T>(path: string): T[] => readFileSync(path, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as T);

function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { map: { type: 'string' }, rerun: { type: 'string', multiple: true } } });
  const [before, after] = positionals;
  if (!before || !after || !values.map) throw new Error('usage: compare-results.ts <before.jsonl> <after.jsonl> --map <migration-report.jsonl> [--rerun <before-again.jsonl> …]');
  const comparison = compareResults(jsonl(before), jsonl(after), jsonl(values.map), (values.rerun ?? []).map((path) => jsonl<RecordedResult>(path)));
  console.log(formatComparison(comparison));
  const changed = regressions(comparison);
  console.log(changed.length ? `changed by the migration: ${changed.map((doc) => doc.document).join(', ')}` : 'no migrated document changed its results');
  if (changed.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();

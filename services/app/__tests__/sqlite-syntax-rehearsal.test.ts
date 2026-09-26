/**
 * The migration rehearsal's tooling (scripts/migrate/sqlite): recording every
 * document's results on this tree's engine, comparing two recordings through
 * the differential check's normalisation, and looping the migration to done.
 */
import { artifactQuery } from '@/lib/artifact-document';
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { dataflowForRow, getArtifactById } from '@/lib/artifacts';
import { runSqliteSyntaxMigrationBatch, type SqliteSyntaxMigrationOutcome } from '@/lib/sqlite-syntax-migration';
import { mintToken } from '@/lib/tokens';
import { recordResults, type RecordedResult } from '../../../scripts/migrate/sqlite/record-results';
import { compareResults, formatComparison, regressions } from '../../../scripts/migrate/sqlite/compare-results';
import { conflictReport, runMigration } from '../../../scripts/migrate/sqlite/run-migration';

const harness = useAppHarness();

async function legacy(id: string, source: string) {
  const db = await harness.db();
  await artifactQuery(db, `INSERT INTO artifacts (id,token_id,source,format,version) VALUES ($1,'tok_rehearsal',$2,'markup',1)`, [id, source]);
}

describe('recordResults', () => {
  it('records every live document query with its defaults, and query errors, on this engine', async () => {
    const token = await mintToken('mxmx_test_rehearsal');
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: token.token, json: {
      markup: '<Helmet><Value name="k" type="number" default={2} /><Query name="nums">{`select 1 as n union all select $k as n`}</Query></Helmet><DataTable data="$nums" />',
    } }));
    expect(res.status).toBe(201);
    const doc = ((await res.json()) as { id: string }).id;
    await legacy('zzbrok', `<Helmet><Query name="broken">{\`select json_extract('{', '$.a') as v\`}</Query></Helmet><DataTable data="$broken" />`);
    await legacy('zztrsh', '<Helmet><Query name="gone">{`select 1 as n`}</Query></Helmet><DataTable data="$gone" />');
    await legacy('zzplan', '<p>No data</p>');
    const db = await harness.db();
    await db.query("UPDATE artifacts SET deleted_at=now() WHERE id='zztrsh'");
    const lines: RecordedResult[] = [];
    const summary = await recordResults({ db, getArtifactById, dataflowForRow }, (line) => lines.push(line));
    expect(summary).toEqual({ documents: 3, results: 2 });
    expect(lines.find((line) => line.document === doc)).toEqual({ document: doc, query: 'nums', columns: ['n'], rows: [[1], [2]] });
    expect(lines.find((line) => line.document === 'zzbrok')).toMatchObject({ query: 'broken', error: expect.stringMatching(/json/i) });
  });

  it('marks a result the engine cut short', async () => {
    const db = await harness.db();
    await legacy('zzpage', '<Helmet><Query name="page">{`select 1 as n`}</Query></Helmet><DataTable data="$page" />');
    const cut = async () => ({ flow: { imports: [], values: [], queries: [], mutations: [] }, state: { values: {}, errors: {}, tables: { page: { columns: [{ name: 'n', type: 'number' as const }], rows: [{ n: 1 }], truncated: true, totalRows: 7 } } } });
    const lines: RecordedResult[] = [];
    await recordResults({ db, getArtifactById, dataflowForRow: cut }, (line) => lines.push(line));
    expect(lines).toEqual([{ document: 'zzpage', query: 'page', columns: ['n'], rows: [[1]], truncated: true, totalRows: 7 }]);
  });
});

describe('compareResults', () => {
  const before: RecordedResult[] = [
    { document: 'aaaaaa', query: 'same', columns: ['ok', 'day'], rows: [[true, '2026-01-02 00:00:00'], [false, null]] },
    { document: 'aaaaaa', query: 'drift', columns: ['n'], rows: [[1], [2]] },
    { document: 'aaaaaa', query: 'today', columns: ['d'], rows: [['2026-01-01']] },
    { document: 'aaaaaa', query: 'broke', columns: ['n'], rows: [[1]] },
    { document: 'aaaaaa', query: 'fixed', error: 'Binder Error' },
    { document: 'bbbbbb', query: 'renamed', columns: ['a'], rows: [] },
    { document: 'cccccc', error: 'timeout' },
  ];
  const after: RecordedResult[] = [
    { document: 'aaaaaa', query: 'same', columns: ['ok', 'day'], rows: [[0, null], [1, '2026-01-02']] },
    { document: 'aaaaaa', query: 'drift', columns: ['n'], rows: [[1], [3]] },
    { document: 'aaaaaa', query: 'today', columns: ['d'], rows: [['2026-01-02']] },
    { document: 'aaaaaa', query: 'broke', error: 'no such column: x' },
    { document: 'aaaaaa', query: 'fixed', columns: ['n'], rows: [] },
    { document: 'bbbbbb', query: 'renamed', columns: ['b'], rows: [] },
    { document: 'bbbbbb', query: 'added', columns: ['n'], rows: [] },
  ];
  const report: SqliteSyntaxMigrationOutcome[] = [
    { artifactId: 'aaaaaa', outcome: 'conflict' },
    { artifactId: 'aaaaaa', outcome: 'converted', version: 2, changes: [{ rule: 'sql', declaration: 'today', detail: 'translated to SQLite', notes: ['reads the built-in $_now (the current time, UTC) where DuckDB read its clock'] }] },
    { artifactId: 'bbbbbb', outcome: 'unchanged' },
  ];

  it('joins by document and query and classifies each through the shared normalisation', () => {
    const { documents, totals } = compareResults(before, after, report);
    expect(documents.map((d) => [d.document, d.outcome, d.failed])).toEqual([['aaaaaa', 'converted', undefined], ['bbbbbb', 'unchanged', undefined], ['cccccc', undefined, { before: 'timeout' }]]);
    expect(Object.fromEntries(documents[0].queries.map((q) => [q.query, q.status]))).toEqual({ broke: 'failed after', drift: 'differs', fixed: 'failed before', same: 'identical', today: 'differs' });
    expect(documents[0].queries.find((q) => q.query === 'drift')!.detail).toBe('before only [2]; after only [3]');
    expect(documents[0].queries.find((q) => q.query === 'today')!.clock).toBe(true);
    expect(documents[1].queries.map((q) => [q.query, q.status, q.detail])).toEqual([['added', 'only after', undefined], ['renamed', 'differs', 'columns ["a"] → ["b"]']]);
    expect(totals).toEqual({ documents: 3, clock: 1, identical: 1, differs: 3, cut: 0, 'unstable before': 0, 'failed before': 1, 'failed after': 1, 'failed both': 0, 'only before': 0, 'only after': 1 });
  });

  it('counts as changed by the migration every document it did not leave as a conflict', () => {
    const comparison = compareResults(before, after, report);
    expect(regressions(comparison).map((d) => d.document)).toEqual(['aaaaaa', 'bbbbbb']);
    expect(regressions(compareResults(before, after, [{ artifactId: 'aaaaaa', outcome: 'conflict' }, { artifactId: 'bbbbbb', outcome: 'conflict' }])).map((d) => d.document)).toEqual([]);
    const cleared = compareResults(before.filter((r) => r.document === 'aaaaaa' && 'query' in r && r.query === 'same'), after.filter((r) => r.document === 'aaaaaa' && 'query' in r && r.query === 'same'), report);
    expect(regressions(cleared)).toEqual([]);
  });

  it('says a result either engine shipped only a window of was cut — not changed — when the windows agree', () => {
    const report: SqliteSyntaxMigrationOutcome[] = [{ artifactId: 'dddddd', outcome: 'converted' }];
    const table = (rows: unknown[][], cut?: number): RecordedResult => ({ document: 'dddddd', query: 'page', columns: ['n'], rows, ...(cut ? { truncated: true as const, totalRows: cut } : {}) });
    const before = compareResults([table([[1], [2]], 3)], [table([[3], [2], [1]])], report);
    expect(before.documents[0]!.queries).toEqual([{ query: 'page', status: 'cut', detail: 'before shipped 2 of 3 rows; after 3 of 3' }]);
    expect(before.totals.cut).toBe(1);
    expect(regressions(before)).toEqual([]);
    const after = compareResults([table([[3], [2], [1]])], [table([[1], [3]], 3)], report);
    expect(after.documents[0]!.queries[0]).toMatchObject({ status: 'cut', detail: 'before shipped 3 of 3 rows; after 2 of 3' });
    // Both windows of one unordered result of the same size: which rows travel is the engine's choice.
    const both = compareResults([table([[1], [2]], 3)], [table([[2], [3]], 3)], report);
    expect(both.documents[0]!.queries[0]).toMatchObject({ status: 'cut' });
    const lost = compareResults([table([[1], [2]], 3)], [table([[3], [2]])], report);
    expect(lost.documents[0]!.queries[0]).toMatchObject({ status: 'differs', detail: 'before only [1]; after only [3]' });
    const grown = compareResults([table([[1], [2]], 3)], [table([[2], [3]], 4)], report);
    expect(grown.documents[0]!.queries[0]).toMatchObject({ status: 'differs' });
    const short = compareResults([table([[1], [2]], 4)], [table([[3], [2], [1]])], report);
    expect(short.documents[0]!.queries[0]).toMatchObject({ status: 'differs' });
  });

  it('says a result the previous engine gave differently on a second run was unstable, not changed', () => {
    const run = (rows: unknown[][]): RecordedResult => ({ document: 'eeeeee', query: 'top', columns: ['n'], rows });
    const unstable = compareResults([run([[1], [2]])], [run([[1], [4]])], [{ artifactId: 'eeeeee', outcome: 'converted' }], [[run([[1], [3]])]]);
    expect(unstable.documents[0]!.queries).toEqual([{ query: 'top', status: 'unstable before', detail: 'the previous engine answered differently on a second run; before only [2]; after only [4]' }]);
    expect(regressions(unstable)).toEqual([]);
    const stable = compareResults([run([[1], [2]])], [run([[1], [4]])], [{ artifactId: 'eeeeee', outcome: 'converted' }], [[run([[2], [1]])]]);
    expect(stable.documents[0]!.queries[0]).toMatchObject({ status: 'differs' });
    // Any of several reruns disagreeing is enough: ties at a cut come up only on some runs.
    const third = compareResults([run([[1], [2]])], [run([[1], [4]])], [{ artifactId: 'eeeeee', outcome: 'converted' }], [[run([[2], [1]])], [run([[1], [5]])]]);
    expect(third.documents[0]!.queries[0]).toMatchObject({ status: 'unstable before' });
  });

  it('prints only what is not identical, then totals', () => {
    const text = formatComparison(compareResults(before, after, report));
    expect(text).not.toMatch(/\bsame\b/);
    expect(text).toContain('today (reads the clock)');
    expect(text).toContain('cccccc  not in the migration report\n  document failed before: timeout');
    expect(text.split('\n').at(-1)).toBe('documents 3; queries: identical 1, differs 3, cut 0, unstable before 0, failed before 1, failed after 1, failed both 0, only before 0, only after 1; reading the clock 1');
  });
});

describe('runMigration', () => {
  it('loops dry-run batches to the end without moving the cursor, then migrates for real', async () => {
    await legacy('aaaaaa', '<p>A</p>'); await legacy('bbbbbb', '<Helmet><Value name="s" type="number" default={0} /><Mutation name="next">{`update _signals set s = s + 1`}</Mutation></Helmet><Button run="$next">Next</Button>'); await legacy('cccccc', '<p>C</p>');
    const db = await harness.db();
    const dry: SqliteSyntaxMigrationOutcome[] = [];
    expect(await runMigration(db, runSqliteSyntaxMigrationBatch, { batchSize: 1, dryRun: true }, (o) => dry.push(...o))).toEqual({ batches: 3, documents: 3 });
    expect(dry.map((o) => o.outcome)).toEqual(['unchanged', 'conflict', 'unchanged']);
    expect((await db.query('SELECT 1 FROM node_identity_migration_jobs')).rows).toHaveLength(0);
    const real: SqliteSyntaxMigrationOutcome[] = [];
    expect(await runMigration(db, runSqliteSyntaxMigrationBatch, { batchSize: 2, dryRun: false }, (o) => real.push(...o))).toEqual({ batches: 2, documents: 3 });
    const text = conflictReport(real);
    expect(text).toMatch(/^bbbbbb\n {2}manual next \[\d+-\d+\]: the _signals mutation computes s from page values/);
    expect(text.split('\n').at(-1)).toBe('documents 3: converted 0, unchanged 2, current 0, conflict 1');
  });
});

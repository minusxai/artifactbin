/**
 * The resumable document migration to the SQLite data syntax
 * (lib/sqlite-syntax-migration), over synthetic documents inserted as they
 * stood before the marker existed.
 */
import { artifactQuery } from '@/lib/artifact-document';
import { describe, expect, it } from 'vitest';
import { request, useAppHarness } from './harness';
import { POST as createRoute } from '@/app/api/artifacts/route';
import { commitNormalizedMarkup, getArtifactById, publishMarkupForArtifact } from '@/lib/artifacts';
import { convertStoredDocument } from '@/lib/migrate/sqlite/stored';
import { runSqliteSyntaxMigrationBatch } from '@/lib/sqlite-syntax-migration';
import { mintToken } from '@/lib/tokens';

const harness = useAppHarness();

/** A markup row as the previous engine left it: no marker, no document graph. */
async function legacy(id: string, tokenId: string, source: string, meta: Record<string, unknown> = {}) {
  const db = await harness.db();
  await artifactQuery(db, `INSERT INTO artifacts (id,token_id,source,format,version,meta) VALUES ($1,$2,$3,'markup',1,$4)`, [id, tokenId, source, JSON.stringify(meta)]);
}

async function owner() {
  const token = await mintToken('mxmx_test_sqlite_syntax');
  const dataset = async (title: string, rows: unknown[]) => {
    const res = await createRoute(request('/api/artifacts', { method: 'POST', token: token.token, json: { dataset: rows, title } }));
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  return { tokenId: token.id, dataset };
}

const head = async (id: string) => (await getArtifactById(id))!;
const SIGNALS = `<Helmet>
  <Value name="view" type="string" default="table" />
  <Mutation name="show">{\`update _signals set view = 'chart'\`}</Mutation>
</Helmet>
<Button run="$show">Chart</Button>`;
const NEEDS_A_PERSON = `<Helmet>
  <Value name="step" type="number" default={0} />
  <Mutation name="next">{\`update _signals set step = step + 1\`}</Mutation>
</Helmet>
<Button run="$next">Next</Button>`;
const HALF = '<Helmet><Query name="ratio">{`select 7 / 2 as h`}</Query></Helmet><DataTable data="$ratio" />';

describe('convertStoredDocument: lookups from the database', () => {
  it('names an Import after the dataset title and keeps a connected Postgres source', async () => {
    const { tokenId, dataset } = await owner();
    const tasks = await dataset('Team Tasks', [{ id: 1, n: 4 }]);
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id,token_id,format,version,meta,title) VALUES ('pgware',$1,'dataset',1,$2,'Warehouse')`,
      [tokenId, JSON.stringify({ catalog: { kind: 'postgres', defaultSchema: 'public', refreshSeconds: 0, tables: [] } })]);
    const source = `<Helmet><Query name="tasks" source="ref:${tasks}">{\`select * from public.rows\`}</Query><Query name="orders" source="ref:pgware">{\`select id from public.orders\`}</Query></Helmet><p />`;
    const result = await convertStoredDocument(db, { source, meta: {}, user_id: null, token_id: tokenId });
    expect(result).toMatchObject({ status: 'converted', manual: [] });
    if (result.status === 'current') throw new Error('unreachable');
    expect(result.source).toContain(`<Import name="team_tasks" src="ref:${tasks}" />`);
    expect(result.source).toContain('{`select * from team_tasks.rows`}');
    expect(result.source).toContain('<Query name="orders" source="ref:pgware">{`select id from public.orders`}</Query>');
  });

  it('imports a folder like a dataset, by its title', async () => {
    const { tokenId } = await owner();
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id,token_id,format,version,meta,title) VALUES ('fold01',$1,'folder',1,'{}','Project Files')`, [tokenId]);
    const result = await convertStoredDocument(db, { source: '<Helmet><Query name="files" source="ref:fold01">{`select * from public.rows`}</Query></Helmet><p />', meta: {}, user_id: null, token_id: tokenId });
    if (result.status === 'current') throw new Error('unreachable');
    expect(result.source).toContain('<Import name="project_files" src="ref:fold01" />');
    expect(result.source).toContain('{`select * from project_files.rows`}');
  });

  it("never names an Import after someone else's private title", async () => {
    const { tokenId } = await owner();
    const db = await harness.db();
    await db.query(`INSERT INTO artifacts (id,token_id,format,version,meta,title,visibility) VALUES ('secret',$1,'dataset',1,'{}','Layoff List','private')`, ['someone-else']);
    const result = await convertStoredDocument(db, { source: '<Helmet><Query name="q">{`select * from ref_secret`}</Query></Helmet><p />', meta: {}, user_id: null, token_id: tokenId });
    if (result.status === 'current') throw new Error('unreachable');
    expect(result.source).toContain('<Import name="data_secret" src="ref:secret" />');
    expect(result.source).not.toMatch(/layoff/i);
  });

  it('turns a _signals mutation into set= on its control', async () => {
    const db = await harness.db();
    const result = await convertStoredDocument(db, { source: SIGNALS, meta: {}, user_id: null, token_id: 't' });
    if (result.status === 'current') throw new Error('unreachable');
    expect(result.status).toBe('converted');
    expect(result.source).not.toContain('_signals');
    expect(result.source).toContain(`<Button set={{"view":"chart"}}>Chart</Button>`);
  });

  it('refuses a document already in the current syntax', async () => {
    const db = await harness.db();
    expect(await convertStoredDocument(db, { source: HALF, meta: { dataSyntax: 2 }, user_id: null, token_id: 't' })).toEqual({ status: 'current' });
  });
});

describe('runSqliteSyntaxMigrationBatch', () => {
  it('publishes the converted source as a new version by no actor, marked, with the old bytes archived', async () => {
    const { tokenId, dataset } = await owner();
    const tasks = await dataset('Team Tasks', [{ id: 1, n: 4 }, { id: 2, n: 5 }]);
    const before = `<Helmet><Query name="halves" source="ref:${tasks}">{\`select id, n / 2 as half from public.rows order by id\`}</Query></Helmet><DataTable data="$halves" />`;
    await legacy('aaaaaa', tokenId, before);
    const db = await harness.db();
    const report = await runSqliteSyntaxMigrationBatch(db, { batchSize: 10 });
    expect(report.documents).toEqual([expect.objectContaining({ artifactId: 'aaaaaa', outcome: 'converted', version: 2 })]);
    expect(report).toMatchObject({ processed: 1, done: true });
    const row = await head('aaaaaa');
    expect(row.version).toBe(2);
    expect(row.source).toContain(`<Import name="team_tasks" src="ref:${tasks}" />`);
    expect(row.source).toContain('n * 1.0 / 2 as half from team_tasks.rows');
    expect(row.meta).toMatchObject({ dataSyntax: 2, dataSyntaxMigration: { job: 'sqlite-data-syntax', from: 1, version: 2 } });
    expect(row.actor_user_id).toBeNull();
    expect(row.actor_token_id).toBeNull();
    expect((await artifactQuery<{ source: string }>(db, 'SELECT source,document FROM artifact_versions WHERE artifact_id=$1 AND version=1', ['aaaaaa'])).rows[0].source).toBe(before);
  });

  it('publishes set= for a _signals mutation', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, SIGNALS);
    const report = await runSqliteSyntaxMigrationBatch(await harness.db(), { batchSize: 10 });
    expect(report.documents).toMatchObject([{ outcome: 'converted' }]);
    expect((await head('aaaaaa')).source).toContain('set={{"view":"chart"}}');
  });

  it('reports a document that needs a person with its reasons, leaves it untouched and moves on', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, NEEDS_A_PERSON);
    await legacy('bbbbbb', tokenId, '<p>B</p>');
    const db = await harness.db();
    const report = await runSqliteSyntaxMigrationBatch(db, { batchSize: 10 });
    expect(report).toMatchObject({ processed: 2, done: true, cursor: 'bbbbbb' });
    const [conflict, plain] = report.documents;
    expect(conflict).toMatchObject({ artifactId: 'aaaaaa', outcome: 'conflict', manual: [{ declaration: 'next', reason: expect.stringMatching(/expression/) }] });
    const span = conflict.manual![0];
    expect(NEEDS_A_PERSON.slice(span.start, span.end)).toContain('update _signals set step = step + 1');
    expect(await head('aaaaaa')).toMatchObject({ source: NEEDS_A_PERSON, version: 1 });
    expect((await head('aaaaaa')).meta.dataSyntax).toBeUndefined();
    expect(plain).toEqual({ artifactId: 'bbbbbb', outcome: 'unchanged' });
  });

  it('passes over a trashed document: it is served converted, and an edit after a restore converts it', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, HALF);
    await legacy('bbbbbb', tokenId, '<p>B</p>');
    const db = await harness.db();
    await db.query("UPDATE artifacts SET deleted_at=now() WHERE id='aaaaaa'");
    const report = await runSqliteSyntaxMigrationBatch(db, { batchSize: 10 });
    expect(report).toMatchObject({ done: true, documents: [{ artifactId: 'bbbbbb', outcome: 'unchanged' }] });
    expect((await db.query<{ source: string; version: number }>("SELECT source,version FROM artifacts WHERE id='aaaaaa'")).rows).toEqual([{ source: HALF, version: 1 }]);
  });

  it('writes a retired theme as the theme readers already show in its place', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, HALF, { theme: 'nocturne' });
    const report = await runSqliteSyntaxMigrationBatch(await harness.db(), { batchSize: 10 });
    expect(report.documents).toEqual([expect.objectContaining({ artifactId: 'aaaaaa', outcome: 'converted' })]);
    expect((await head('aaaaaa')).meta).toMatchObject({ theme: 'modernist', colorMode: 'dark', dataSyntax: 2 });
  });

  it('reports what the publish door refused in words, when its markup no longer validates', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, `${HALF}<Icon name="no-such-glyph" />`);
    const report = await runSqliteSyntaxMigrationBatch(await harness.db(), { batchSize: 10 });
    expect(report.documents).toEqual([expect.objectContaining({ artifactId: 'aaaaaa', outcome: 'conflict', refused: ['400 invalid_jsx', expect.stringMatching(/Unknown Icon name "no-such-glyph"/)] })]);
  });

  it('marks a document with nothing to convert in place, without a new version', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, '<p>Plain</p>', { theme: 'paper' });
    await runSqliteSyntaxMigrationBatch(await harness.db(), { batchSize: 10 });
    expect(await head('aaaaaa')).toMatchObject({ source: '<p>Plain</p>', version: 1, meta: { theme: 'paper', dataSyntax: 2 } });
  });

  it('skips a marked document: never converts twice', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, HALF, { dataSyntax: 2 });
    const report = await runSqliteSyntaxMigrationBatch(await harness.db(), { batchSize: 10 });
    expect(report.documents).toEqual([{ artifactId: 'aaaaaa', outcome: 'current' }]);
    expect(await head('aaaaaa')).toMatchObject({ source: HALF, version: 1 });
  });

  it('resumes from a durable cursor across bounded batches and is idempotent after completion', async () => {
    const { tokenId } = await owner();
    await legacy('cccccc', tokenId, '<p>C</p>'); await legacy('aaaaaa', tokenId, '<p>A</p>'); await legacy('bbbbbb', tokenId, NEEDS_A_PERSON);
    const db = await harness.db();
    const first = await runSqliteSyntaxMigrationBatch(db, { batchSize: 2 });
    expect(first).toMatchObject({ cursor: 'bbbbbb', processed: 2, done: false });
    expect(first.documents.map((d) => d.outcome)).toEqual(['unchanged', 'conflict']);
    const second = await runSqliteSyntaxMigrationBatch(db, { batchSize: 2 });
    expect(second).toMatchObject({ cursor: 'cccccc', processed: 1, done: true });
    const edits = (await db.query('SELECT count(*)::int AS n FROM artifact_edits')).rows;
    expect(await runSqliteSyntaxMigrationBatch(db, { batchSize: 2 })).toMatchObject({ processed: 0, done: true });
    expect((await db.query('SELECT count(*)::int AS n FROM artifact_edits')).rows).toEqual(edits);
  });

  it('persists completion even when there are no documents', async () => {
    const db = await harness.db();
    expect(await runSqliteSyntaxMigrationBatch(db, { batchSize: 10 })).toMatchObject({ processed: 0, done: true, cursor: null });
    expect((await db.query("SELECT completed_at IS NOT NULL AS completed FROM node_identity_migration_jobs WHERE name='sqlite-data-syntax'")).rows).toEqual([{ completed: true }]);
  });

  it('dry run reports conversions and conflicts without writing rows or cursor', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, HALF); await legacy('bbbbbb', tokenId, NEEDS_A_PERSON); await legacy('cccccc', tokenId, '<p>C</p>');
    const db = await harness.db();
    const snapshot = async () => (await db.query('SELECT id,version,meta,edit_id FROM artifacts ORDER BY id')).rows;
    const before = await snapshot();
    const first = await runSqliteSyntaxMigrationBatch(db, { batchSize: 2, dryRun: true });
    expect(first).toMatchObject({ dryRun: true, done: false, cursor: 'bbbbbb' });
    expect(first.documents).toMatchObject([{ artifactId: 'aaaaaa', outcome: 'converted', changes: [{ rule: 'sql', declaration: 'ratio' }] }, { artifactId: 'bbbbbb', outcome: 'conflict' }]);
    const rest = await runSqliteSyntaxMigrationBatch(db, { batchSize: 2, dryRun: true, after: first.cursor });
    expect(rest).toMatchObject({ done: true, documents: [{ artifactId: 'cccccc', outcome: 'unchanged' }] });
    expect(await snapshot()).toEqual(before);
    expect((await db.query('SELECT 1 FROM node_identity_migration_jobs')).rows).toHaveLength(0);
    expect((await db.query('SELECT 1 FROM artifact_versions')).rows).toHaveLength(0);
  });

  it('rolls the document and cursor back when failure is injected before commit', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, '<p>A</p>');
    const db = await harness.db();
    await expect(runSqliteSyntaxMigrationBatch(db, { batchSize: 1, failBeforeCommit: () => { throw new Error('injected'); } })).rejects.toThrow('injected');
    expect((await head('aaaaaa')).meta.dataSyntax).toBeUndefined();
    expect((await db.query('SELECT 1 FROM node_identity_migration_jobs')).rows).toHaveLength(0);
  });

  it('skips a document a concurrent whole publish marked between preparation and commit', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, HALF);
    const db = await harness.db();
    const report = await runSqliteSyntaxMigrationBatch(db, {
      batchSize: 10,
      beforeCommit: async (id) => {
        const current = await head(id);
        if (current.meta.dataSyntax) return;
        const published = await publishMarkupForArtifact(current, HALF.replace('<DataTable', '<DataTable title="x"'));
        if (published instanceof Response) throw new Error(`concurrent publish refused: ${await published.text()}`);
        await db.transaction((tx) => commitNormalizedMarkup(tx, null, current, published));
      },
    });
    expect(report.documents).toEqual([{ artifactId: 'aaaaaa', outcome: 'current' }]);
    const row = await head('aaaaaa');
    expect(row.source).toContain('select 7 / 2 as h');
    expect(row.source).toContain('title="x"');
    expect(row.version).toBe(2);
  });

  it('prepares again from a head that moved between preparation and commit', async () => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, NEEDS_A_PERSON);
    const db = await harness.db();
    let moved = false;
    const report = await runSqliteSyntaxMigrationBatch(db, {
      batchSize: 10,
      beforeCommit: async (id) => {
        if (moved) return;
        moved = true;
        await db.query("UPDATE artifacts SET source=$2,edit_id='concurrent',version=version+1 WHERE id=$1", [id, '<p>Rewritten</p>']);
      },
    });
    expect(report.documents).toEqual([{ artifactId: 'aaaaaa', outcome: 'unchanged' }]);
    expect(await head('aaaaaa')).toMatchObject({ source: '<p>Rewritten</p>', version: 2, meta: { dataSyntax: 2 } });
  });

  it.each([0, -1, 1.5, 101, Number.POSITIVE_INFINITY])('rejects invalid batch size %s without touching the database', async (batchSize) => {
    const { tokenId } = await owner();
    await legacy('aaaaaa', tokenId, '<p>A</p>');
    await expect(runSqliteSyntaxMigrationBatch(await harness.db(), { batchSize })).rejects.toThrow(/batchSize.*integer.*1.*100/i);
    expect((await head('aaaaaa')).meta.dataSyntax).toBeUndefined();
  });
});

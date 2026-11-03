/**
 * THE PREPARED DATABASE CACHE (src/sqlite/prepared.ts): a catalog read whose every source carries a
 * content key is answered from a database the engine already built for exactly that catalog and
 * those keys. Keys travel first; a miss answers `rowsRequired` and the caller resends the rows.
 * The engine derives the entry's identity itself — schema, tables, columns, model SQL and the keys —
 * so a role view with fewer columns, other rows or another model never reads another view's entry.
 */
import { afterAll, describe, expect, it } from 'vitest';
import type { DatasetColumn, QueryOutcome, Row, RunInput, SqlService } from '@artifactbin/contracts';
import { isQueryFailure } from '@artifactbin/contracts';
import { serveSql, sqlClient } from '@artifactbin/sql';
import { loadSqlite, PreparedCache, type ReadBounds } from '@artifactbin/sql/core';
import { createSql } from '@artifactbin/sql/local';
import { createSqliteSql } from '@artifactbin/sql/sqlite';

const engine = await loadSqlite();
const BOUNDS: ReadBounds = { limit: 100, pageLimit: 100, timeoutMs: 2000 };
const COLUMNS: DatasetColumn[] = [{ name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'secret', type: 'string' }];
const ROWS: Row[] = [{ id: 1, region: 'east', secret: 'a' }, { id: 2, region: 'west', secret: 'b' }, { id: 3, region: 'east', secret: 'c' }];
const EAST = ROWS.filter((r) => r.region === 'east');

interface Read { key?: string; columns?: DatasetColumn[]; rows?: Row[] | null; model?: string }
/** A one-table catalog read keyed `key`; `rows: null` sends the keys alone. */
function read(sql: string, { key = 'owner', columns = COLUMNS, rows = ROWS, model }: Read = {}): RunInput {
  return {
    catalog: { defaultSchema: 'public', tables: [{ schema: 'public', name: 'rows', columns, source: 't0', key }, ...(model ? [{ schema: 'public', name: 'm', columns: [{ name: 'n', type: 'number' as const }], sql: model }] : [])] },
    tables: rows ? { t0: { rows, columns: COLUMNS } } : {},
    queries: [{ name: 'q', sql }], params: {},
  };
}
const ALL = 'select * from public.rows order by id';
const rowsOf = (outcome: QueryOutcome | undefined) => {
  if (!outcome || isQueryFailure(outcome)) throw new Error(JSON.stringify(outcome));
  return outcome.rows;
};
const missed = (outcome: QueryOutcome | undefined) => !!outcome && isQueryFailure(outcome) && outcome.rowsRequired === true;

describe('keys first, rows on a miss', () => {
  it('a miss without rows asks for them, and the resend answers', () => {
    const cache = new PreparedCache(1 << 20);
    expect(missed(engine.run(read(ALL, { rows: null }), BOUNDS, cache).q)).toBe(true);
    expect(rowsOf(engine.run(read(ALL), BOUNDS, cache).q)).toEqual(ROWS);
  });

  it('a hit answers from the built database: keys alone suffice, and nothing is rebuilt', () => {
    const cache = new PreparedCache(1 << 20);
    rowsOf(engine.run(read(ALL), BOUNDS, cache).q);
    expect(rowsOf(engine.run(read(ALL, { rows: null }), BOUNDS, cache).q)).toEqual(ROWS);
    expect(rowsOf(engine.run(read('select count(*) as n from rows', { rows: null }), BOUNDS, cache).q)).toEqual([{ n: 3 }]);
    // A resend that races a hit is answered from the entry too.
    rowsOf(engine.run(read(ALL), BOUNDS, cache).q);
    expect(cache.stats()).toMatchObject({ entries: 1, builds: 1, hits: 3 });
  });

  it('a read cannot change the cached database for the next one', () => {
    const cache = new PreparedCache(1 << 20);
    rowsOf(engine.run(read(ALL), BOUNDS, cache).q);
    expect(isQueryFailure(engine.run(read('delete from rows', { rows: null }), BOUNDS, cache).q!)).toBe(true);
    const endless = engine.run(read('with recursive c(n) as (select 1 union all select n + 1 from c) select count(*) as n from c', { rows: null }), { ...BOUNDS, timeoutMs: 100 }, cache).q;
    expect(endless).toMatchObject({ timedOut: true });
    expect(rowsOf(engine.run(read(ALL, { rows: null }), BOUNDS, cache).q)).toEqual(ROWS);
  });

  it('a read with an unkeyed source runs on a throwaway database, as before', () => {
    const cache = new PreparedCache(1 << 20);
    const input = read(ALL);
    delete input.catalog!.tables[0]!.key;
    expect(rowsOf(engine.run(input, BOUNDS, cache).q)).toEqual(ROWS);
    expect(cache.stats()).toMatchObject({ entries: 0, builds: 0 });
  });
});

describe('the byte cap', () => {
  const size = (() => { const c = new PreparedCache(1 << 30); rowsOf(engine.run(read(ALL), BOUNDS, c).q); return c.stats().bytes; })();

  it('evicts the least recently used database, never holding more than the cap', () => {
    expect(size).toBeGreaterThan(0);
    const cap = Math.floor(size * 2.5);
    const cache = new PreparedCache(cap);
    for (const key of ['a', 'b']) rowsOf(engine.run(read(ALL, { key }), BOUNDS, cache).q);
    rowsOf(engine.run(read(ALL, { key: 'a', rows: null }), BOUNDS, cache).q); // a is now the most recent
    rowsOf(engine.run(read(ALL, { key: 'c' }), BOUNDS, cache).q);
    expect(cache.stats()).toMatchObject({ entries: 2 });
    expect(cache.stats().bytes).toBeLessThanOrEqual(cap);
    expect(missed(engine.run(read(ALL, { key: 'b', rows: null }), BOUNDS, cache).q)).toBe(true);
    expect(rowsOf(engine.run(read(ALL, { key: 'a', rows: null }), BOUNDS, cache).q)).toEqual(ROWS);
    expect(rowsOf(engine.run(read(ALL, { key: 'c', rows: null }), BOUNDS, cache).q)).toEqual(ROWS);
  });

  it('answers a database larger than the cap once and keeps nothing', () => {
    const cache = new PreparedCache(Math.floor(size / 2));
    expect(rowsOf(engine.run(read(ALL), BOUNDS, cache).q)).toEqual(ROWS);
    expect(cache.stats()).toMatchObject({ entries: 0, bytes: 0 });
    expect(missed(engine.run(read(ALL, { rows: null }), BOUNDS, cache).q)).toBe(true);
  });
});

describe('one view never reads another view\'s database', () => {
  it('another key (a role view, a row-ID set) over the same catalog misses', () => {
    const cache = new PreparedCache(1 << 20);
    rowsOf(engine.run(read(ALL), BOUNDS, cache).q);
    expect(missed(engine.run(read(ALL, { key: 'viewer', rows: null }), BOUNDS, cache).q)).toBe(true);
    expect(rowsOf(engine.run(read(ALL, { key: 'viewer', rows: EAST }), BOUNDS, cache).q)).toEqual(EAST);
    // Both stay: the owner's entry still answers every row, the viewer's only theirs.
    expect(rowsOf(engine.run(read(ALL, { rows: null }), BOUNDS, cache).q)).toEqual(ROWS);
    expect(rowsOf(engine.run(read(ALL, { key: 'viewer', rows: null }), BOUNDS, cache).q)).toEqual(EAST);
  });

  it('the same key with a hidden column misses, and the view built for it cannot read that column', () => {
    const cache = new PreparedCache(1 << 20);
    rowsOf(engine.run(read(ALL), BOUNDS, cache).q);
    const visible = COLUMNS.filter((c) => c.name !== 'secret');
    expect(missed(engine.run(read('select secret from rows', { columns: visible, rows: null }), BOUNDS, cache).q)).toBe(true);
    expect(missed(engine.run(read(ALL, { columns: visible, rows: null }), BOUNDS, cache).q)).toBe(true);
    expect(rowsOf(engine.run(read(ALL, { columns: visible }), BOUNDS, cache).q)).toEqual(ROWS.map(({ secret: _, ...r }) => r));
    const hidden = engine.run(read('select secret from rows', { columns: visible, rows: null }), BOUNDS, cache).q!;
    expect(isQueryFailure(hidden) && hidden.error).toMatch(/secret/);
    expect(rowsOf(engine.run(read('select secret from rows order by id', { rows: null }), BOUNDS, cache).q)).toEqual(ROWS.map(({ secret }) => ({ secret })));
  });

  it('the same keys with another model (a role that reads the model empty) miss', () => {
    const cache = new PreparedCache(1 << 20);
    const model = 'select count(*) as n from rows';
    expect(rowsOf(engine.run(read('select n from m', { model }), BOUNDS, cache).q)).toEqual([{ n: 3 }]);
    const empty = `SELECT * FROM (${model}) AS af_hidden_model WHERE 0`;
    expect(missed(engine.run(read('select n from m', { model: empty, rows: null }), BOUNDS, cache).q)).toBe(true);
    expect(rowsOf(engine.run(read('select n from m', { model: empty }), BOUNDS, cache).q)).toEqual([]);
    expect(rowsOf(engine.run(read('select n from m', { model, rows: null }), BOUNDS, cache).q)).toEqual([{ n: 3 }]);
  });
});

const pool = createSql({ timeoutMs: 2000 }, { workers: 1 });
const servers = [serveSql(createSqliteSql({ timeoutMs: 2000 })), serveSql(pool)];
afterAll(async () => { await Promise.all(servers.map((s) => s.close())); await pool.close(); });
const SHAPES: Array<[string, SqlService]> = [
  ['in this thread', createSqliteSql({ timeoutMs: 2000 })],
  ['in this thread over HTTP', sqlClient(servers[0]!.listen(0).url, { deadlineMs: 5000 })],
  ['worker threads', pool],
  ['worker threads over HTTP', sqlClient(servers[1]!.listen(0).url, { deadlineMs: 5000 })],
];

describe.each(SHAPES)('%s', (name, svc) => {
  it('keys first: a miss asks for the rows, the resend answers, and the keys alone answer after it', async () => {
    const key = `shape ${name}`;
    expect(missed((await svc.run(read(ALL, { key, rows: null }))).q)).toBe(true);
    expect(rowsOf((await svc.run(read(ALL, { key }))).q)).toEqual(ROWS);
    const east = { ...read('select id from rows where region = $r order by id', { key, rows: null }), params: { r: 'east' } };
    expect(rowsOf((await svc.run(east)).q)).toEqual([{ id: 1 }, { id: 3 }]);
  });
});

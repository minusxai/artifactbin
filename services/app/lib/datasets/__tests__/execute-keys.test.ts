/**
 * KEYS FIRST (execute.ts over services/sql's prepared databases): a dataset read sends each stored table's
 * content key without its rows; only a miss reads the object, applies the role view and resends the rows.
 * A table's key names the object, its declared columns, the row IDs a door adds and the role view, so a
 * viewer, another row-ID set or another object never reads a database prepared for someone else.
 */
import { describe, expect, it } from 'vitest';
import type { RunInput } from '@artifactbin/contracts';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { executeCatalog } from '../execute';
import type { CatalogRowView, DatasetCatalog } from '../types';

const ROWS = [{ id: 1, region: 'east', amount: 10 }, { id: 2, region: 'west', amount: 20 }, { id: 3, region: 'east', amount: 30 }];
const catalog = (objectKey = 'object-a'): DatasetCatalog => ({
  kind: 'stored', defaultSchema: 'public', refreshSeconds: 0,
  tables: [{ schema: 'public', name: 'rows', objectKey, columns: [{ name: 'id', type: 'number' }, { name: 'region', type: 'string' }, { name: 'amount', type: 'number' }] }],
});
const east: CatalogRowView = { identity: 'east-viewer', catalog: (c) => c, rows: (_t, rows) => rows.filter((r) => r.region === 'east') };

/** A fresh engine (its own prepared databases), a counting object store and a log of every SQL call. */
function fixture() {
  const sql = createSqliteSql();
  const calls: RunInput[] = [];
  const gets: string[] = [];
  const objects = { get: async (key: string) => { gets.push(key); return Buffer.from(JSON.stringify(ROWS)); } };
  const run = (statement: string, opts: { view?: CatalogRowView | null; objectKey?: string; rowIds?: { table: number; column: string; ids: readonly string[] } } = {}) => {
    const read = catalog(opts.objectKey);
    if (opts.rowIds) read.tables[0]!.columns.push({ name: opts.rowIds.column, type: 'string' });
    return executeCatalog(read, statement, {}, { view: opts.view ?? null, objects, rowIds: opts.rowIds, execute: (input) => { calls.push(input); return sql.run(input); } });
  };
  const keyOf = (input: RunInput) => input.catalog!.tables[0]!.key;
  return { run, calls, gets, keyOf };
}
const ALL = 'select id from public.rows order by id';

describe('keys first', () => {
  it('a repeated read sends the keys alone: the object is read and the rows travel only on the first miss', async () => {
    const { run, calls, gets } = fixture();
    expect((await run(ALL)).rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(calls.map((c) => Object.keys(c.tables))).toEqual([[], ['dataset_table_0']]);
    expect(gets).toEqual(['object-a']);
    expect((await run('select sum(amount) as total from public.rows')).rows).toEqual([{ total: 60 }]);
    expect((await run(ALL)).rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(calls.map((c) => Object.keys(c.tables))).toEqual([[], ['dataset_table_0'], [], []]);
    expect(gets).toEqual(['object-a']);
  });

  it('a role view, another row-ID set or another object is another key, and reads only its own rows', async () => {
    const { run, calls, keyOf } = fixture();
    await run(ALL);
    expect((await run(ALL, { view: east })).rows).toEqual([{ id: 1 }, { id: 3 }]);
    const ids = (prefix: string) => ({ table: 0, column: 'row_id', ids: ROWS.map((r) => `${prefix}${r.id}`) });
    expect((await run('select row_id from public.rows order by id', { rowIds: ids('a') })).rows).toEqual([{ row_id: 'a1' }, { row_id: 'a2' }, { row_id: 'a3' }]);
    expect((await run('select row_id from public.rows order by id', { rowIds: ids('b') })).rows).toEqual([{ row_id: 'b1' }, { row_id: 'b2' }, { row_id: 'b3' }]);
    expect((await run('select row_id from public.rows order by id', { rowIds: ids('b'), view: east })).rows).toEqual([{ row_id: 'b1' }, { row_id: 'b3' }]);
    await run(ALL, { objectKey: 'object-b' });
    // Each first read missed and resent: six reads, six distinct keys, each sent twice.
    const keys = calls.map(keyOf);
    expect(new Set(keys).size).toBe(6);
    expect(calls.filter((c) => Object.keys(c.tables).length)).toHaveLength(6);
    // The owner's key still answers every row after the views built theirs.
    expect((await run(ALL)).rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(Object.keys(calls.at(-1)!.tables)).toEqual([]);
  });
});

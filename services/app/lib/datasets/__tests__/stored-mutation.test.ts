import { describe, expect, it } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { compileStoredMutation } from '../stored-mutation';
import type { DatasetCatalog } from '../types';
const columns = [{ name: 'id', type: 'number' as const }, { name: 'status', type: 'string' as const }];
const catalog: DatasetCatalog = { kind: 'stored', defaultSchema: 'public', refreshSeconds: 0, tables: [
  { schema: 'public', name: 'rows', columns, objectKey: 'rows-object' },
  { schema: 'other', name: 'rows', columns, objectKey: 'other-object' },
  { schema: 'public', name: 'model', columns, sql: 'select * from rows' },
] };
const service = createSql({ maxRows: 100, timeoutMs: 2000 });
describe('stored mutation target compiler', () => {
  it('rewrites only the target span and preserves comments, aliases, literals and row bindings', () => {
    const sql = "/* update fake */ UPDATE public /* schema */ . rows AS r SET status=$_value WHERE r.id=$_row.id AND status='public.rows; $_row.id' -- public.rows\n;";
    const result = compileStoredMutation(catalog, sql, 'ref_dataset');
    expect(result.table).toBe(catalog.tables[0]);
    expect(result.sql).toBe(sql.replace('public /* schema */ . rows', '"ref_dataset"'));
  });
  it('resolves quoted qualified targets and quotes generated physical identifiers', () => {
    const result = compileStoredMutation(catalog, 'delete from "other"."rows" as r where r.id=1', 'ref_"odd');
    expect(result.table).toBe(catalog.tables[1]);
    expect(result.sql).toBe('delete from "ref_""odd" as r where r.id=1');
  });
  it.each([
    ['update rows set status=$_value where rows.id=$_row.id', [{ id: 1, status: 'new' }]],
    ['update public.rows as r set status=$_value where r.id=$_row.id', [{ id: 1, status: 'new' }]],
    ['insert into rows(id,status) values (2,$_value)', [{ id: 1, status: 'old' }, { id: 2, status: 'new' }]],
    ['delete from public.rows where rows.id=$_row.id', []],
  ])('executes native DuckDB mutation %s', async (sql, rows) => {
    const result = compileStoredMutation(catalog, sql, 'ref_dataset');
    const outcome = await service.mutate({ table: { name: 'ref_dataset', columns, rows: [{ id: 1, status: 'old' }] }, sql: result.sql, params: { _value: 'new' }, row: { columns, values: { id: 1, status: 'old' } } });
    expect(outcome).toMatchObject({ rows });
  });
  it('keeps DuckDB dollar strings and escaped strings opaque to statement scanning', async () => {
    const sql = "update rows set status=$tag$literal; delete from rows; $_value$tag$ where id=1; /* trailing ; */";
    const result = compileStoredMutation(catalog, sql, 'ref_dataset');
    expect(await service.mutate({ table: { name: 'ref_dataset', columns, rows: [{ id: 1, status: 'old' }] }, sql: result.sql, params: {} })).toMatchObject({ rows: [{ id: 1, status: 'literal; delete from rows; $_value' }] });
  });
  it.each(['select * from rows', 'create table rows(id int)', 'update model set status=1', 'delete from unknown', 'delete from pg_catalog.pg_class', 'delete from rows; delete from rows', 'insert into rows values(1,\'x\'); select 1', 'with x as (select 1) delete from rows', 'delete from rows /* unclosed', 'update "rows set status=1', 'update rows set status=\'unclosed'])('rejects %s', sql => {
    expect(() => compileStoredMutation(catalog, sql, 'ref_dataset')).toThrow(/Stored mutation/);
  });
  it('rejects writes to Postgres catalogs', () => {
    expect(() => compileStoredMutation({ ...catalog, kind: 'postgres' }, 'delete from rows', 'ref_dataset')).toThrow(/Stored mutation/);
  });
});

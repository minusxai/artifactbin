/**
 * The engine's WRITE mode — `runMutation`: one DML statement (INSERT, UPDATE
 * or DELETE, judged by statement TYPE) over exactly the target table, with
 * `$params` bound, in a throwaway instance. What comes back is the table's
 * new rows (the same `TableResult` shape reads produce) plus the count of
 * rows the statement touched — so the caller can store the rows and nothing
 * else about the engine has to change.
 */
import { describe, expect, it } from 'vitest';
import { dryRunMutations, isQueryFailure, runMutation } from '@/lib/sql/engine';
import type { DatasetColumn } from '@/lib/story/dataset-shape';

const COLUMNS: DatasetColumn[] = [{ name: 'choice', type: 'string' }, { name: 'votes', type: 'number' }];
const ROWS = [{ choice: 'ramen', votes: 2 }, { choice: 'tacos', votes: 1 }];
const table = { name: 'ref_abc123', rows: ROWS, columns: COLUMNS };

describe('runMutation', () => {
  it('INSERT: binds $params, returns the grown table and the affected count; columns are unchanged', async () => {
    const out = await runMutation({ table, sql: 'insert into ref_abc123 (choice, votes) values ($c, $v)', params: { c: 'salad', v: 5 } });
    expect(isQueryFailure(out)).toBe(false);
    if (isQueryFailure(out)) return;
    expect(out.affected).toBe(1);
    expect(out.rows).toHaveLength(3);
    expect(out.rows[2]).toEqual({ choice: 'salad', votes: 5 });
    expect(out.columns).toEqual(COLUMNS);
  });

  it('UPDATE and DELETE apply to the current rows', async () => {
    const up = await runMutation({ table, sql: 'update ref_abc123 set votes = votes + 1 where choice = $c', params: { c: 'ramen' } });
    if (isQueryFailure(up)) throw new Error(up.error);
    expect(up.affected).toBe(1);
    expect(up.rows.find((r) => r.choice === 'ramen')?.votes).toBe(3);
    const del = await runMutation({ table, sql: 'delete from ref_abc123 where votes < 2', params: {} });
    if (isQueryFailure(del)) throw new Error(del.error);
    expect(del.affected).toBe(1);
    expect(del.rows).toEqual([{ choice: 'ramen', votes: 2 }]);
  });

  it('a parameter is BOUND, never interpolated', async () => {
    const out = await runMutation({ table, sql: 'insert into ref_abc123 (choice, votes) values ($c, 1)', params: { c: "x'); delete from ref_abc123; --" } });
    if (isQueryFailure(out)) throw new Error(out.error);
    expect(out.rows).toHaveLength(3);
    expect(out.rows[2].choice).toBe("x'); delete from ref_abc123; --");
  });

  it('refuses by statement TYPE: SELECT, DDL, PRAGMA and multi-statement bodies never run', async () => {
    for (const sql of [
      'select * from ref_abc123',
      'create table t (a int)',
      'drop table ref_abc123',
      'insert into ref_abc123 (choice, votes) values (\'a\', 1); delete from ref_abc123',
      'set threads = 1',
    ]) {
      const out = await runMutation({ table, sql, params: {} });
      expect(isQueryFailure(out), sql).toBe(true);
      if (isQueryFailure(out)) expect(out.error, sql).toMatch(/INSERT, UPDATE or DELETE|exactly one statement/);
    }
  });

  it('only the target table exists in the instance — another dataset or a query name is a missing table', async () => {
    const out = await runMutation({ table, sql: 'insert into ref_abc123 select * from ref_zzzzzz', params: {} });
    expect(isQueryFailure(out)).toBe(true);
    if (isQueryFailure(out)) expect(out.error).toMatch(/ref_zzzzzz/);
  });

  it('the declared column types are enforced by the engine (a word in a number column fails, the table is untouched)', async () => {
    const out = await runMutation({ table, sql: 'insert into ref_abc123 (choice, votes) values ($c, $v)', params: { c: 'x', v: 'many' } });
    expect(isQueryFailure(out)).toBe(true);
    if (isQueryFailure(out)) expect(out.error).toMatch(/Could not convert|Conversion|cast/i);
  });

  it('a write past the row cap is refused as FULL, and reports the count it would have reached', async () => {
    const out = await runMutation({ table, sql: 'insert into ref_abc123 select choice, votes from ref_abc123', params: {}, limit: 3 });
    expect(isQueryFailure(out)).toBe(true);
    if (isQueryFailure(out)) {
      expect(out.full).toBe(true);
      expect(out.error).toMatch(/3 rows/);
    }
  });
});

describe('dryRunMutations', () => {
  it('prepares each mutation against the target shape: an unknown column, a SELECT and a missing table are named', async () => {
    const dry = await dryRunMutations({
      tables: { ref_abc123: { columns: COLUMNS } },
      mutations: [
        { name: 'ok', sql: 'insert into ref_abc123 (choice, votes) values ($c, $v)', target: 'abc123' },
        { name: 'col', sql: 'insert into ref_abc123 (chioce) values ($c)', target: 'abc123' },
        { name: 'sel', sql: 'select * from ref_abc123', target: 'abc123' },
        { name: 'tbl', sql: 'delete from ref_zzzzzz', target: 'zzzzzz' },
      ],
      paramNames: ['c', 'v'],
    });
    expect(dry.errors.map((e) => e.name)).toEqual(['col', 'sel', 'tbl']);
    expect(dry.errors[0].error).toMatch(/chioce/);
    expect(dry.errors[1].error).toMatch(/INSERT, UPDATE or DELETE/);
    expect(dry.errors[2].error).toMatch(/ref_zzzzzz/);
  });
});

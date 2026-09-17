import { afterAll, describe, expect, it } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { serveSql, sqlClient } from '@artifactbin/sql';
import { localWriteTarget, runLocalStateMutation } from '../local-state';
import { initialTables, initialValues, type Dataflow } from '../dataflow';

const service = createSql({ maxRows: 10, timeoutMs: 2000 });
const server = serveSql(service);
const remote = sqlClient(server.listen(0).url);
afterAll(() => server.close());
const flow: Dataflow = {
  values: [
    { kind: 'scalar', name: 'view', type: 'string', default: 'table', start: 0, end: 0 },
    { kind: 'scalar', name: 'open', type: 'boolean', default: false, start: 0, end: 0 },
    { kind: 'scalar', name: 'count', type: 'number', default: 1, start: 0, end: 0 },
    { kind: 'table', name: 'drafts', rows: [{id: 1, name: 'First'}], columns: [{name: 'id', type: 'number'}, {name: 'name', type: 'string'}], start: 0, end: 0 },
  ], queries: [],
};
const snapshot = () => ({ values: initialValues(flow), tables: initialTables(flow) });

it('recognizes direct SQL targets without treating literals/comments as commands', () => {
  expect(localWriteTarget('/* update ignored */ UPDATE _signals SET open=true')).toEqual({name: '_signals', operation: 'update'});
  expect(localWriteTarget("insert into drafts(name) values ('delete from _signals')")).toEqual({name: 'drafts', operation: 'insert'});
  expect(localWriteTarget('delete from drafts where id=1')).toEqual({name: 'drafts', operation: 'delete'});
  expect(localWriteTarget('update other.drafts set name=null')).toBeNull();
  expect(localWriteTarget('select 1')).toBeNull();
});

describe.each([['in-process', service], ['HTTP', remote]] as const)('local state through %s SQL', (_, engine) => {
  const run = (sql: string, target = '_signals', state = snapshot()) => runLocalStateMutation(flow, {sql, target}, state, engine);
  it('dry-runs local targets with the same schema and statement checks as execution', async () => {
    const result = await engine.dryRunMutations({tables: {_signals: {columns: [{name: 'open', type: 'boolean'}]}}, mutations: [
      {name: 'ok', target: '_signals', tableName: '_signals', sql: 'update _signals set open=true'},
      {name: 'bad', target: '_signals', tableName: '_signals', sql: 'update _signals set missing=true'},
    ], paramNames: []});
    expect(result.errors.map(e => e.name)).toEqual(['bad']);
  });
  it('updates multiple typed signals atomically using real SQL expressions', async () => {
    const state = snapshot();
    const before = structuredClone(state);
    const result = await run("update _signals set view=upper(view), open=not open, count=count+2", '_signals', state);
    expect(result).toMatchObject({target: '_signals', affected: 1, table: {rows: [{view: 'TABLE', open: true, count: 3}]}});
    expect(state).toEqual(before);
  });
  it('inserts, updates and deletes inline rows without changing declaration defaults', async () => {
    const state = snapshot();
    const inserted = await run("insert into drafts values (2, 'Second')", 'drafts', state);
    expect(inserted.table.rows).toHaveLength(2);
    const next = {...state, tables: {...state.tables, drafts: inserted.table}};
    const updated = await run("update drafts set name=upper(name) where id=2", 'drafts', next);
    expect(updated.table.rows).toContainEqual({id: 2, name: 'SECOND'});
    const deleted = await run('delete from drafts where id=1', 'drafts', {...next, tables: {...next.tables, drafts: updated.table}});
    expect(deleted.table.rows).toEqual([{id: 2, name: 'SECOND'}]);
    expect(snapshot()).toEqual(state);
  });
  it('binds signal values as parameters rather than interpolating SQL', async () => {
    const state = snapshot();
    state.values.view = "x'); delete from drafts; --";
    const result = await run('insert into drafts values (2, $view)', 'drafts', state);
    expect(result.table.rows).toContainEqual({id: 2, name: state.values.view});
  });
  it.each(['insert into _signals values (null,false,0)', 'delete from _signals'])('refuses structural signals change: %s', async sql => {
    await expect(run(sql)).rejects.toThrow(/only UPDATE/i);
  });
  it('rejects undeclared and persistent targets', async () => {
    await expect(run('update ref_abc123 set x=1', 'ref_abc123')).rejects.toThrow(/local table/i);
    await expect(run('update missing set x=1', 'missing')).rejects.toThrow(/local table/i);
  });
  it('rejects a mismatched target and attempts to read another state domain', async () => {
    await expect(run('update drafts set name=null')).rejects.toThrow(/target/i);
    await expect(run('update drafts set name=(select secret from ref_abc123)', 'drafts')).rejects.toThrow();
  });
  it('rejects multiple statements, SQL type failures, and forged snapshot types without changing input', async () => {
    const state = snapshot();
    const before = structuredClone(state);
    await expect(run('update _signals set open=true; delete from _signals', '_signals', state)).rejects.toThrow();
    await expect(run("update _signals set count='not a number'", '_signals', state)).rejects.toThrow();
    expect(state).toEqual(before);
    await expect(run('update _signals set open=true', '_signals', {...state, values: {...state.values, count: 'bad'}})).rejects.toThrow(/type/i);
  });
  it('does not return a partial result when row caps or affected-row guards fail', async () => {
    await expect(run("insert into drafts select i, 'x' from range(20) t(i)", 'drafts')).rejects.toThrow();
    await expect(runLocalStateMutation(flow, {sql: 'update drafts set name=null where id=999', target: 'drafts', expectedAffected: 1}, snapshot(), engine)).rejects.toThrow();
  });
});

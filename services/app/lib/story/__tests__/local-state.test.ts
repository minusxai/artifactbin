/**
 * A LOCAL WRITE, executed (lib/story/local-state): the compiled mutation over
 * the reader's current rows of its table Value, typed by the declaration, in
 * this thread and over HTTP — the same engine, the same answer.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { serveSql, sqlClient } from '@artifactbin/sql';
import { runLocalStateMutation } from '../local-state';
import { bindParams, bindTypes, initialTables, mutationParams, valueTypes } from '../compiled-flow';
import { compiledOf } from '@/test/helpers/compiled';

const service = createSqliteSql({ maxRows: 10, timeoutMs: 2000 });
const server = serveSql(service);
const remote = sqlClient(server.listen(0).url);
afterAll(() => server.close());
const HELMET = '<Value name="view" default="table" /><Value name="open" type="boolean" default={false} /><Value name="count" type="number" default={1} />'
  + '<Value name="drafts" type="table" value={[{"id": 1, "name": "First"}]} columns={[{"name": "id", "type": "number"}, {"name": "name", "type": "string"}]} />';
const flow = await compiledOf(`${HELMET}`
  + '<Mutation name="insert">{`insert into drafts values (2, \'Second\')`}</Mutation>'
  + '<Mutation name="upper">{`update drafts set name=upper(name) where id=2`}</Mutation>'
  + '<Mutation name="remove">{`delete from drafts where id=1`}</Mutation>'
  + '<Mutation name="named">{`insert into drafts values (2, $view)`}</Mutation>'
  + '<Mutation name="many">{`insert into drafts select value, \'x\' from json_each(\'[1,2,3,4,5,6,7,8,9,10,11,12]\')`}</Mutation>'
  + '<Mutation name="guarded" expectedAffected={1}>{`update drafts set name=null where id=999`}</Mutation>'
  + '<Mutation name="typed">{`update drafts set id=\'not a number\'`}</Mutation>');
const tables = () => initialTables(flow);

describe.each([['in this thread', service], ['HTTP', remote]] as const)('local state through %s SQL', (_, engine) => {
  const run = (name: string, current = tables(), values: Record<string, string | number | boolean | null> = {}) => {
    const m = flow.mutations.find((x) => x.name === name)!;
    const params = mutationParams(m);
    return runLocalStateMutation(flow, m, { tables: current }, engine, { params: bindParams(params, values), paramTypes: bindTypes(params, valueTypes(flow)) });
  };

  it('inserts, updates and deletes inline rows without changing declaration defaults', async () => {
    const state = tables();
    const inserted = await run('insert', state);
    expect(inserted).toMatchObject({ target: 'drafts', affected: 1 });
    expect(inserted.table.rows).toHaveLength(2);
    const updated = await run('upper', { ...state, drafts: inserted.table });
    expect(updated.table.rows).toContainEqual({ id: 2, name: 'SECOND' });
    const deleted = await run('remove', { ...state, drafts: updated.table });
    expect(deleted.table.rows).toEqual([{ id: 2, name: 'SECOND' }]);
    expect(tables()).toEqual(state);
  });

  it('binds page values as parameters rather than interpolating SQL', async () => {
    const view = "x'); delete from drafts; --";
    const result = await run('named', tables(), { view });
    expect(result.table.rows).toContainEqual({ id: 2, name: view });
  });

  it('rejects SQL type failures and forged row types without changing its input', async () => {
    const state = tables();
    const before = structuredClone(state);
    await expect(run('typed', state)).rejects.toThrow();
    await expect(run('insert', { ...state, drafts: { ...state.drafts!, rows: [{ id: 'bad', name: 'x' }] } })).rejects.toThrow(/type/i);
    expect(state).toEqual(before);
  });

  it('does not return a partial result when row caps or affected-row guards fail', async () => {
    await expect(run('many')).rejects.toThrow();
    await expect(run('guarded')).rejects.toThrow();
  });
});

it('refuses a mutation that writes an imported dataset as a local write', async () => {
  const imported = await compiledOf('<Import name="d" src="ref:abc123" /><Mutation name="w">{`delete from d.rows`}</Mutation>', { abc123: [{ name: 'id', type: 'number' }] });
  await expect(runLocalStateMutation(imported, imported.mutations[0]!, { tables: {} }, service, { params: {}, paramTypes: {} })).rejects.toThrow(/local table/);
});

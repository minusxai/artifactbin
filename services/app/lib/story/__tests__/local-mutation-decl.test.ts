/**
 * LOCAL TABLE VALUES: a `<Value type="table">` the reader's own writes change.
 * A `<Mutation>` that writes one compiles to a local target (no dataset, no
 * ref, no permission to check), queries read the reader's current rows, and
 * the removed `_signals` row is refused at publish with what to use instead.
 */
import { describe, expect, it } from 'vitest';
import { runDataflow } from '@/lib/sql/run-dataflow';
import { dataRefs, queriesReadingValues } from '../compiled-flow';
import { collectRefUses } from '../refs';
import { compiledOf } from '@/test/helpers/compiled';

const HELMET = '<Value name="open" type="boolean" default={false} /><Value name="drafts" type="table" value={[{"id": 1}]} />';

describe('declared local SQL state', () => {
  it('queries current inline rows and page values without mutating declaration defaults', async () => {
    const flow = await compiledOf(`${HELMET}<Query name="current">{\`select id, $open as open from drafts\`}</Query>`);
    const result = await runDataflow(flow, {}, { values: { open: true }, localTables: { drafts: [{ id: 7 }] } });
    expect(result.errors).toEqual({});
    expect(result.tables.current!.rows).toEqual([{ id: 7, open: 1 }]);
    expect(queriesReadingValues(flow, ['open'])).toEqual(['current']);
    expect(queriesReadingValues(flow, ['drafts'])).toEqual(['current']);
    const defaults = await runDataflow(flow, {});
    expect(defaults.tables.current!.rows).toEqual([{ id: 1, open: 0 }]);
  });

  it('rejects attempts to override undeclared tables or supply invalid local row types', async () => {
    const flow = await compiledOf(`${HELMET}<Query name="current">{\`select id from drafts\`}</Query>`);
    await expect(runDataflow(flow, {}, { localTables: { elsewhere: [{ id: 1 }] } })).rejects.toThrow(/declared/i);
    await expect(runDataflow(flow, {}, { localTables: { drafts: [{ id: 'wrong' }] } })).rejects.toThrow(/type/i);
  });

  it.each(['insert into drafts values (2)', 'delete from drafts where id=1', 'update drafts set id = 2'])('compiles a local target without a ref: %s', async (sql) => {
    const flow = await compiledOf(`${HELMET}<Mutation name="change">{\`${sql}\`}</Mutation>`);
    expect(flow.mutations[0]).toMatchObject({ target: { local: 'drafts' } });
    expect(dataRefs(flow)).toEqual([]);
    expect(collectRefUses(`<Helmet>${HELMET}<Mutation name="change">{\`${sql}\`}</Mutation></Helmet>`)).toEqual([]);
  });

  it.each([
    ['update _signals set open=true', /_signals, which is removed — .*set= on a Button/],
    ['update missing set id=1', /no such table/],
    ['update open set id=1', /open as a table, but it is a scalar <Value>/],
  ])('refuses %s at publish', async (sql, message) => {
    await expect(compiledOf(`${HELMET}<Mutation name="change">{\`${sql}\`}</Mutation>`)).rejects.toThrow(message);
  });

  it('refuses a mutation that writes a local table and reads a query', async () => {
    await expect(compiledOf(`${HELMET}<Query name="q">{\`select 2 as id\`}</Query><Mutation name="change">{\`insert into drafts select id from q\`}</Mutation>`)).rejects.toThrow(/reads the query q/);
  });
});

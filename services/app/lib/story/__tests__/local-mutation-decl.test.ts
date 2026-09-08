import { describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { splitHelmet, validateHelmet } from '../helmet';
import { mutationTargets, queriesDependingOn, validateDataflow, type Dataflow } from '../dataflow';
import { collectRefUses } from '../refs';
import { dryRunDataflow } from '../data-checks';
import { runDataflow } from '@/lib/sql/run-dataflow';

const source = (sql: string) => `<Helmet><Value name="open" type="boolean" default={false} /><Value name="drafts" type="table" value={[{id: 1}]} /><Mutation name="change">{${JSON.stringify(sql)}}</Mutation></Helmet>`;
function parse(sql: string) {
  const result = parseJsx(source(sql));
  if (!result.ok) throw new Error(result.error);
  const {content} = splitHelmet(result.nodes);
  const flow: Dataflow = {values: content.values, queries: content.queries, mutations: content.mutations};
  return {flow, errors: [...validateHelmet(result.nodes), ...validateDataflow(flow, [])]};
}
describe('declared local SQL state', () => {
  it('queries current inline rows and scalar projection without mutating declaration defaults', async () => {
    const flow = parse('update _signals set open=true').flow;
    flow.queries = [{name: 'current', sql: 'select id, open from drafts cross join _signals', params: [], refs: [], start: 0, end: 0}];
    const result = await runDataflow(flow, {}, {values: {open: true}, localTables: {drafts: [{id: 7}]}});
    expect(result.errors).toEqual({});
    expect(result.tables.current.rows).toEqual([{id: 7, open: true}]);
    expect(queriesDependingOn(flow, ['open'])).toEqual(['current']);
    const defaults = await runDataflow(flow, {});
    expect(defaults.tables.current.rows).toEqual([{id: 1, open: false}]);
  });
  it('rejects attempts to override undeclared tables or supply invalid local row types', async () => {
    const flow = parse('update _signals set open=true').flow;
    await expect(runDataflow(flow, {}, {localTables: {ref_abc123: [{id: 1}]}})).rejects.toThrow(/declared/i);
    await expect(runDataflow(flow, {}, {localTables: {drafts: [{id: 'wrong'}]}})).rejects.toThrow(/type/i);
  });
  it('validates local SQL without attempting to load an artifact named _signals or drafts', async () => {
    const load = vi.fn(async () => null);
    const result = await dryRunDataflow(parse('update _signals set open=true').flow, load);
    expect(result.kind).toBe('ok');
    expect(load).not.toHaveBeenCalled();
    expect((await dryRunDataflow(parse('update drafts set id=2').flow, load)).kind).toBe('ok');
    expect(load).not.toHaveBeenCalled();
    expect((await dryRunDataflow(parse('update _signals set missing=true').flow, load)).kind).toBe('sql');
  });
  it.each(['update _signals set open=true', 'insert into drafts values (2)', 'delete from drafts where id=1'])('admits local target: %s', sql => {
    const {flow, errors} = parse(sql);
    expect(errors).toEqual([]);
    expect(flow.mutations?.[0]).toMatchObject({scope: 'local', refs: []});
    expect(mutationTargets(flow)).toEqual([]);
    expect(collectRefUses(source(sql))).toEqual([]);
  });
  it.each(['insert into _signals values (true)', 'delete from _signals', 'update missing set id=1', 'update open set id=1'])('rejects invalid local target: %s', sql => {
    expect(parse(sql).errors.length).toBeGreaterThan(0);
  });
  it('rejects a mutation mixing local and dataset tables', () => {
    expect(parse('insert into drafts select * from ref_abc123').errors.length).toBeGreaterThan(0);
  });
  it('retains the existing persistent dataset target and ref graph', () => {
    const {flow, errors} = parse('update ref_abc123 set id=1');
    expect(errors).toEqual([]);
    expect(flow.mutations?.[0]).toMatchObject({target: 'abc123', refs: ['abc123']});
    expect(flow.mutations?.[0].scope).toBeUndefined();
    expect(mutationTargets(flow)).toEqual(['abc123']);
  });
});

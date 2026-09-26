import { describe, expect, it, vi } from 'vitest';
import { createSqliteSql } from '@artifactbin/sql/sqlite';
import { runLocalStateMutation } from '@/lib/story/local-state';
import { bindParams, bindTypes, initialTables, initialValues, mutationParams } from '@/lib/story/compiled-flow';
import { compiledOf } from '@/test/helpers/compiled';
import { createDataflowStore, type QueryTransport } from '../store';

const engine = createSqliteSql();
const flow = await compiledOf(
  '<Value name="count" type="number" default={0} />'
  + '<Value name="counter" type="table" value={[{"n":0}]} />'
  + '<Value name="drafts" type="table" value={[{"id":1}]} />'
  + '<Query name="derived">{`select * from drafts`}</Query>'
  + '<Mutation name="inc">{`update counter set n = n + 1`}</Mutation>'
  + '<Mutation name="inc_again">{`update counter set n = n + 1`}</Mutation>'
  + '<Mutation name="add">{`insert into drafts values (2)`}</Mutation>'
  + '<Mutation name="log">{`insert into drafts values ($count)`}</Mutation>',
);
const transport = (): QueryTransport => ({
  run: vi.fn(async () => ({tables: initialTables(flow), errors: {}})),
  page: vi.fn(async () => ({columns: [], rows: []})),
  mutate: vi.fn<NonNullable<QueryTransport['mutate']>>(async (request) => {
    const tables = initialTables(flow);
    for (const [key, rows] of Object.entries(request.localTables ?? {})) tables[key] = {...tables[key]!, rows};
    const m = flow.mutations.find(x => x.name === request.mutation)!;
    const params = mutationParams(m);
    return {dataset: '', local: await runLocalStateMutation(flow, m, {tables}, engine, {params: bindParams(params, request.args), paramTypes: bindTypes(params, {count: 'number'})})};
  }),
});
const make = (t = transport()) => createDataflowStore({flow, state: {values: initialValues(flow), tables: initialTables(flow), errors: {}, mutationAccess: {}}}, {transport: t, debounceMs: 0});

describe('local SQL mutations in the document store', () => {
  it('needs no dataset edit permission, commits the local table, and keeps other viewers independent', async () => {
    const a = make(), b = make();
    expect(a.mutationUnavailable('inc')).toBeNull();
    await a.mutate('inc');
    expect(a.getTable('counter')?.rows).toEqual([{n: 1}]);
    expect(b.getTable('counter')?.rows).toEqual([{n: 0}]);
    expect(a.mutating().size).toBe(0);
  });
  it('commits inline rows and passes them to queries without an old response erasing them', async () => {
    const t = transport(), store = make(t);
    await store.mutate('add');
    await vi.waitFor(() => expect(t.run).toHaveBeenCalled());
    expect(t.run).toHaveBeenLastCalledWith({count: 0}, ['derived'], {drafts: [{id: 1}, {id: 2}]});
    expect(store.getTable('drafts')?.rows).toEqual([{id: 1}, {id: 2}]);
    await store.fetchPage('derived', {offset: 0, limit: 10});
    expect(t.page).toHaveBeenLastCalledWith({count: 0}, 'derived', {offset: 0, limit: 10}, {drafts: [{id: 1}, {id: 2}]});
  });
  it('serializes distinct local mutations against the preceding committed state', async () => {
    const store = make();
    await Promise.all([store.mutate('inc'), store.mutate('inc_again')]);
    expect(store.getTable('counter')?.rows).toEqual([{n: 2}]);
  });
  it('deduplicates a double click of the same mutation', async () => {
    const t = transport(), store = make(t);
    await Promise.all([store.mutate('inc'), store.mutate('inc')]);
    expect(store.getTable('counter')?.rows).toEqual([{n: 1}]);
    expect(t.mutate).toHaveBeenCalledTimes(1);
  });
  it('rejects stale SQL results after a value it binds changes while executing', async () => {
    const t = transport();
    const original = t.mutate!;
    let release = () => {};
    t.mutate = vi.fn<NonNullable<QueryTransport['mutate']>>(async (...args) => { await new Promise<void>(resolve => {release = resolve;}); return original(...args); });
    const store = make(t);
    const pending = store.mutate('log'); // binds $count
    const rejected = expect(pending).rejects.toThrow(/changed/i);
    await vi.waitFor(() => expect(t.mutate).toHaveBeenCalled());
    store.setValue('count', 10);
    release();
    await rejected;
    expect(store.getValue('count')).toBe(10);
    expect(store.getTable('drafts')?.rows).toEqual([{id: 1}]);
    expect(store.mutating().size).toBe(0);
  });
  it('commits a result whose own inputs held, although an unrelated value changed meanwhile', async () => {
    const t = transport();
    const original = t.mutate!;
    let release = () => {};
    t.mutate = vi.fn<NonNullable<QueryTransport['mutate']>>(async (...args) => { await new Promise<void>(resolve => {release = resolve;}); return original(...args); });
    const store = make(t);
    const pending = store.mutate('add'); // reads `drafts`, not `count`
    await vi.waitFor(() => expect(t.mutate).toHaveBeenCalled());
    store.setValue('count', 10);
    release();
    await pending;
    expect(store.getTable('drafts')?.rows).toEqual([{id: 1}, {id: 2}]);
    expect(store.getValue('count')).toBe(10);
  });
  it('rejects old results after document replacement', async () => {
    const t = transport();
    const original = t.mutate!;
    let release = () => {};
    t.mutate = vi.fn<NonNullable<QueryTransport['mutate']>>(async (...args) => { await new Promise<void>(resolve => {release = resolve;}); return original(...args); });
    const store = make(t);
    const pending = store.mutate('inc');
    const rejected = expect(pending).rejects.toThrow(/changed/i);
    await vi.waitFor(() => expect(t.mutate).toHaveBeenCalled());
    store.replaceFlow({flow});
    release();
    await rejected;
    expect(store.getTable('counter')?.rows).toEqual([{n: 0}]);
  });
  it('re-runs the readers of a surviving local draft when a new version arrives with rows computed from the authored ones', async () => {
    const t = transport(), store = make(t);
    await store.mutate('add');
    await vi.waitFor(() => expect(t.run).toHaveBeenCalledTimes(1));
    store.replaceFlow({flow, state: {values: initialValues(flow), tables: {...initialTables(flow), derived: {columns: [], rows: [{id: 1}]}}, errors: {}, mutationAccess: {}}});
    expect(store.getTable('drafts')?.rows).toEqual([{id: 1}, {id: 2}]);
    expect(t.run).toHaveBeenCalledTimes(2);
    expect(t.run).toHaveBeenLastCalledWith({count: 0}, ['derived'], {drafts: [{id: 1}, {id: 2}]});
  });
  it('does not commit an invalid result and clears busy state after failure', async () => {
    const t = transport();
    t.mutate = async () => ({dataset: '', local: {target: 'counter', affected: 1, table: {columns: [{name: 'n', type: 'string'}], rows: [{n: 'bad'}]}}});
    const store = make(t);
    await expect(store.mutate('inc')).rejects.toThrow();
    expect(store.getTable('counter')?.rows).toEqual([{n: 0}]);
    expect(store.mutating().size).toBe(0);
  });
});

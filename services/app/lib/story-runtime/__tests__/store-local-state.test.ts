import { describe, expect, it, vi } from 'vitest';
import { createSql } from '@artifactbin/sql/local';
import { runLocalStateMutation } from '@/lib/story/local-state';
import { initialTables, initialValues, type Dataflow } from '@/lib/story/dataflow';
import { createDataflowStore, type QueryTransport } from '../store';

const engine = createSql();
const flow: Dataflow = {
  values: [
    {kind: 'scalar', name: 'count', type: 'number', default: 0, start: 0, end: 0},
    {kind: 'table', name: 'drafts', rows: [{id: 1}], columns: [{name: 'id', type: 'number'}], start: 0, end: 0},
  ],
  queries: [{name: 'derived', sql: 'select * from drafts', params: [], refs: [], start: 0, end: 0}],
  mutations: [
    {name: 'inc', scope: 'local', target: '_signals', sql: 'update _signals set count=count+1', params: [], refs: [], start: 0, end: 0},
    {name: 'inc_again', scope: 'local', target: '_signals', sql: 'update _signals set count=count+1', params: [], refs: [], start: 0, end: 0},
    {name: 'add', scope: 'local', target: 'drafts', sql: 'insert into drafts values (2)', params: [], refs: [], start: 0, end: 0},
  ],
};
const transport = (): QueryTransport => ({
  run: vi.fn(async () => ({tables: initialTables(flow), errors: {}})),
  page: vi.fn(async () => ({columns: [], rows: []})),
  mutate: vi.fn<NonNullable<QueryTransport['mutate']>>(async (values, name, _row, localTables = {}) => {
    const tables = initialTables(flow);
    for (const [key, rows] of Object.entries(localTables)) tables[key] = {...tables[key], rows};
    return {dataset: '', local: await runLocalStateMutation(flow, flow.mutations!.find(m => m.name === name)!, {values, tables}, engine)};
  }),
});
const make = (t = transport()) => createDataflowStore({flow, state: {values: initialValues(flow), tables: initialTables(flow), errors: {}, mutationAccess: {}}}, {transport: t, debounceMs: 0});

describe('local SQL mutations in the document store', () => {
  it('needs no dataset edit permission, commits signals, and keeps other viewers independent', async () => {
    const a = make(), b = make();
    expect(a.mutationUnavailable('inc')).toBeNull();
    await a.mutate('inc');
    expect(a.getValue('count')).toBe(1);
    expect(b.getValue('count')).toBe(0);
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
    expect(store.getValue('count')).toBe(2);
  });
  it('deduplicates a double click of the same mutation', async () => {
    const t = transport(), store = make(t);
    await Promise.all([store.mutate('inc'), store.mutate('inc')]);
    expect(store.getValue('count')).toBe(1);
    expect(t.mutate).toHaveBeenCalledTimes(1);
  });
  it('rejects stale SQL results after a signal changes while executing', async () => {
    const t = transport();
    const original = t.mutate!;
    let release = () => {};
    t.mutate = vi.fn<NonNullable<QueryTransport['mutate']>>(async (...args) => { await new Promise<void>(resolve => {release = resolve;}); return original(...args); });
    const store = make(t);
    const pending = store.mutate('inc');
    const rejected = expect(pending).rejects.toThrow(/changed/i);
    await vi.waitFor(() => expect(t.mutate).toHaveBeenCalled());
    store.setValue('count', 10);
    release();
    await rejected;
    expect(store.getValue('count')).toBe(10);
    expect(store.mutating().size).toBe(0);
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
    expect(store.getValue('count')).toBe(0);
  });
  it('does not commit an invalid result and clears busy state after failure', async () => {
    const t = transport();
    t.mutate = async () => ({dataset: '', local: {target: '_signals', affected: 1, table: {columns: [{name: 'count', type: 'string'}], rows: [{count: 'bad'}]}}});
    const store = make(t);
    await expect(store.mutate('inc')).rejects.toThrow();
    expect(store.getValue('count')).toBe(0);
    expect(store.mutating().size).toBe(0);
  });
});

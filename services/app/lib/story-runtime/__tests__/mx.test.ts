import { describe, expect, it, vi } from 'vitest';
import { createMx } from '../mx';
import { createDataflowStore } from '../store';
import type { Dataflow } from '@/lib/story/dataflow';

const flow: Dataflow = {
  values: [
    { kind: 'scalar', name: 'count', type: 'number', default: 0, start: 0, end: 0 },
    { kind: 'scalar', name: 'other', type: 'string', default: '', start: 0, end: 0 },
    { kind: 'table', name: 'rows', rows: [{ n: 1 }], columns: [{ name: 'n', type: 'number' }], start: 0, end: 0 },
  ], queries: [],
};
const setup = () => { const store = createDataflowStore({ flow }); return { store, mx: createMx(store) }; };
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

describe('shared mx signal contract', () => {
  it('describes scalars and tables in one namespace and returns detached snapshots', async () => {
    const { mx, store } = setup();
    expect((await mx.describe()).signals).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'count', kind: 'scalar', writable: true }),
      expect.objectContaining({ name: 'rows', kind: 'table', writable: false }),
    ]));
    const snapshot = await mx.read(['count', 'rows']);
    expect(snapshot.signals.count).toEqual({ value: 0, status: 'ready' });
    const table = snapshot.signals.rows!.value as { rows: Record<string, unknown>[] };
    table.rows[0]!.n = 99;
    expect(store.getTable('rows')!.rows[0]!.n).toBe(1);
    store.dispose();
  });
  it('validates the entire patch before any write', async () => {
    const { mx, store } = setup();
    await expect(mx.set({ count: 2, other: 3 })).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    expect(store.getValue('count')).toBe(0);
    await expect(mx.set({ count: Infinity })).rejects.toMatchObject({ code: 'INVALID_VALUE' });
    await expect(mx.set({ rows: null })).rejects.toMatchObject({ code: 'NOT_WRITABLE' });
    /*
     * `$_me` is READ-ONLY, and a script is no exception. The viewer's account
     * id is not the document's data: it is never declared, so `set` refuses it
     * as unwritable and `read`/`describe` never name it — the declared-signal
     * namespace is exactly what those three pin, and the viewer stays outside
     * it. A page reads it in markup (`{$_me ? … : <SignIn/>}`) instead.
     */
    await expect(mx.set({ _me: 'usr_someone' })).rejects.toMatchObject({ code: 'NOT_WRITABLE' });
    await expect(mx.read(['_me'])).rejects.toMatchObject({ code: 'UNKNOWN_SIGNAL' });
    expect((await mx.describe()).signals.map(s => s.name)).not.toContain('_me');
    expect(store.getValue('_me')).toBeNull();
    await mx.set({ count: 4, other: 'ok' });
    expect((await mx.read(['count'])).signals.count!.value).toBe(4);
    store.dispose();
  });
  it('only notifies selected changes, coalesces, and stops synchronously', async () => {
    const { mx, store } = setup();
    const callback = vi.fn();
    const stop = mx.subscribe(['count'], callback);
    expect(callback).not.toHaveBeenCalled();
    await tick();
    expect(callback).toHaveBeenCalledTimes(1);
    await mx.set({ other: 'changed' });
    await tick();
    expect(callback).toHaveBeenCalledTimes(1);
    await mx.set({ count: 1 });
    await mx.set({ count: 2 });
    await tick();
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback.mock.lastCall![0].signals.count.value).toBe(2);
    await mx.set({ count: 3 });
    stop(); stop();
    await tick();
    expect(callback).toHaveBeenCalledTimes(2);
    store.dispose();
  });
  it('revokes a handle when declarations are replaced or the store is disposed', async () => {
    const { mx, store } = setup();
    store.replaceFlow({ flow: { ...flow, values: [...flow.values, {kind:'scalar',name:'newValue',type:'number',default:0,start:0,end:0}] } });
    await expect(mx.read(['count'])).rejects.toMatchObject({ code: 'STALE_INSTANCE' });
    const next = createMx(store);
    await expect(next.read(['count'])).resolves.toBeDefined();
    store.dispose();
    await expect(next.set({ count: 4 })).rejects.toMatchObject({ code: 'STALE_INSTANCE' });
  });
  it('does not accept malformed names or options', async () => {
    const { mx, store } = setup();
    await expect(mx.read(['missing'])).rejects.toMatchObject({ code: 'UNKNOWN_SIGNAL' });
    await expect(mx.read(['count'], { refresh: true })).rejects.toMatchObject({ code: 'NOT_QUERY' });
    await expect(mx.read(['count'], { timeoutMs: -1 })).rejects.toMatchObject({ code: 'INVALID_OPTIONS' });
    store.dispose();
  });
});

it('waits for selected queries, exposes errors, and includes the latest snapshot on timeout', async () => {
  let resolve: (result: { tables: {}; errors: Record<string, string> }) => void = () => {};
  const store = createDataflowStore({ flow: { ...flow, queries: [{ name: 'result', sql: 'select $count', params: ['count'], refs: [], start: 0, end: 0 }] } }, {
    transport: { run: () => new Promise(done => { resolve = done; }), page: async () => ({ rows: [], columns: [] }) },
  });
  const mx = createMx(store);
  store.start();
  expect((await mx.read(['result'])).signals.result!.status).toBe('pending');
  await expect(mx.read(['result'], { wait: true, timeoutMs: 5 })).rejects.toMatchObject({ code: 'TIMEOUT', snapshot: { signals: { result: { status: 'pending' } } } });
  const waiting = mx.read(['result'], { wait: true });
  resolve({ tables: {}, errors: { result: 'Query refused' } });
  expect((await waiting).signals.result).toEqual({ value: null, status: 'error', error: { code: 'QUERY_ERROR', message: 'Query refused' } });
  store.dispose();
});

it('rejects a concurrent mutation before transport and acknowledges a commit independently of query refresh', async () => {
  let complete: (value: { dataset: string }) => void = () => {};
  const mutate = vi.fn(() => new Promise<{ dataset: string }>(resolve => { complete = resolve; }));
  const store = createDataflowStore({ flow: { ...flow, mutations: [{ name: 'save', target: 'owned', sql: 'update ref_owned set n=$count', params: ['count'], refs: ['owned'], start: 0, end: 0 }] },
    state: { values: { count: 0, other: '' }, tables: {}, errors: {}, mutationAccess: { save: null } } }, {
    transport: { mutate, run: async () => ({ tables: {}, errors: {} }), page: async () => ({ rows: [], columns: [] }) },
  });
  const mx = createMx(store);
  const first = mx.mutate('save', { count: 9 });
  await expect(mx.mutate('save', { count: 10 })).rejects.toMatchObject({ code: 'BUSY' });
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(store.getValue('count')).toBe(0);
  complete({ dataset: 'owned' });
  await expect(first).resolves.toMatchObject({ scope: 'dataset', status: 'committed', operationId: expect.any(String) });
  store.dispose();
});

it('passes declared row and cell arguments without creating scalar signals', async () => {
  const mutate = vi.fn(async () => ({dataset:'owned'}));
  const store = createDataflowStore({ flow: { ...flow, mutations: [{ name:'edit', target:'owned', sql:'update ref_owned set n=$_value where id=$_row.id', params:['_row','_value'], refs:['owned'], start:0,end:0 }] }, state:{values:{count:0,other:''},tables:{},errors:{},mutationAccess:{edit:null}} }, {
    transport:{mutate,run:async()=>({tables:{},errors:{}}),page:async()=>({rows:[],columns:[]})},
  });
  await createMx(store).mutate('edit', {_row: {id:1}, _value:3});
  expect(mutate).toHaveBeenCalledWith({count:0,other:'',_value:3},'edit',{id:1});
  expect(store.getState().values).toEqual({count:0,other:''});
  store.dispose();
});

it('initializes and mutates over internal HTTP without crypto.randomUUID', async () => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const store = createDataflowStore({ flow: { ...flow, mutations: [{ name: 'save', target: 'owned', sql: 'update ref_owned set n=$count', params: ['count'], refs: ['owned'], start: 0, end: 0 }] },
    state: { values: { count: 0, other: '' }, tables: {}, errors: {}, mutationAccess: { save: null } } }, {
    transport: { mutate: async () => ({ dataset: 'owned' }), run: async () => ({ tables: {}, errors: {}, mutationAccess: { save: null } }), page: async () => ({ rows: [], columns: [] }) },
  });
  try {
    const mx = createMx(store);
    const snapshot = await mx.read(['count']);
    expect(snapshot.instanceEpoch).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const first = await mx.mutate('save', { count: 1 });
    const second = await mx.mutate('save', { count: 2 });
    expect(first.operationId).toBeTruthy();
    expect(second.operationId).not.toBe(first.operationId);
  } finally { store.dispose(); vi.unstubAllGlobals(); }
});

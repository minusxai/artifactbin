import { describe, expect, it, vi } from 'vitest';
import { createMx } from '../mx';
import { createDataflowStore } from '../store';
import { compiledOf } from '@/test/helpers/compiled';

const VALUES = '<Value name="count" type="number" default={0} /><Value name="other" default="" /><Value name="rows" type="table" value={[{"n":1}]} />';
const OWNED = { owned1: [{ name: 'id', type: 'number' as const }, { name: 'n', type: 'number' as const }, { name: 'd', type: 'string' as const }] };
const flow = await compiledOf(VALUES);
const withMutations = (mutations: string) => compiledOf(`<Import name="owned" src="ref:owned1" />${VALUES}${mutations}`, OWNED);
const RESULT_FLOW = await compiledOf(`${VALUES}<Query name="result">{\`select $count as n\`}</Query>`);
const SAVE_FLOW = await withMutations('<Mutation name="save">{`update owned.rows set n=$count`}</Mutation>');
const EDIT_FLOW = await withMutations('<Mutation name="edit">{`update owned.rows set n=$_value where id=$_row.id`}</Mutation>');
const RESET_FLOW = await compiledOf('<Import name="owned" src="ref:owned1" /><Value name="count" type="number" default={0} /><Value name="draft" url={false} />'
  + '<Mutation name="save" reset="draft">{`insert into owned.rows (d) values ($draft)`}</Mutation><Mutation name="plain">{`update owned.rows set n=$count`}</Mutation>', OWNED);
const JOIN_FLOW = await compiledOf('<Import name="people" src="ref:abc123" /><Value name="item" default="" /><Mutation name="join">{`insert into people.rows (who) select $_me.id`}</Mutation>', { abc123: [{ name: 'who', type: 'user' }] });
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
    store.replaceFlow({ flow: { ...flow, values: [...flow.values, {kind:'scalar',name:'newValue',type:'number',default:0}] } });
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
  const store = createDataflowStore({ flow: RESULT_FLOW }, {
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
  const store = createDataflowStore({ flow: SAVE_FLOW,
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

/**
 * A script that writes a form has to be able to SEE the two things the markup
 * says about it: that a signal is deliberately not in the link, and which
 * signals a mutation clears when it lands. Both are reported only when the
 * declaration carries them, so every existing document's description is
 * byte-identical to what it was.
 */
it('reports url={false} on the signal and reset on the mutation, and nothing extra otherwise', async () => {
  const store = createDataflowStore({
    flow: RESET_FLOW,
    state: { values: { count: 0, draft: null }, tables: {}, errors: {}, mutationAccess: { save: null, plain: null } },
  }, { transport: { mutate: async () => ({ dataset: 'owned' }), run: async () => ({ tables: {}, errors: {} }), page: async () => ({ rows: [], columns: [] }) } });
  const described = await createMx(store).describe();
  expect(described.signals.find(s => s.name === 'draft')).toMatchObject({ name: 'draft', kind: 'scalar', url: false });
  expect('url' in described.signals.find(s => s.name === 'count')!).toBe(false);
  expect(described.mutations.find(m => m.name === 'save')!.reset).toEqual(['draft']);
  expect('reset' in described.mutations.find(m => m.name === 'plain')!).toBe(false);
  store.dispose();
});

it('passes declared row and cell arguments without creating scalar signals', async () => {
  const mutate = vi.fn(async () => ({dataset:'owned'}));
  const store = createDataflowStore({ flow: EDIT_FLOW, state:{values:{count:0,other:''},tables:{},errors:{},mutationAccess:{edit:null}} }, {
    transport:{mutate,run:async()=>({tables:{},errors:{}}),page:async()=>({rows:[],columns:[]})},
  });
  await createMx(store).mutate('edit', {_row: {id:1}, _value:3});
  expect(mutate).toHaveBeenCalledWith({mutation:'edit',args:{},row:{id:1},value:3});
  expect(store.getState().values).toEqual({count:0,other:''});
  store.dispose();
});

it('initializes and mutates over internal HTTP without crypto.randomUUID', async () => {
  const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  vi.stubGlobal('crypto', { getRandomValues });
  const store = createDataflowStore({ flow: SAVE_FLOW,
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

describe('mutate waits for the permission answer', () => {
  const writes = JOIN_FLOW;
  it('a mutate issued before the first query lands waits, then runs with the real answer', async () => {
    let answer!: (r: unknown) => void;
    const run = vi.fn().mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const mutate = vi.fn().mockResolvedValue({ dataset: 'abc123' });
    const store = createDataflowStore({ flow: writes }, { transport: { run, mutate, page: vi.fn() } });
    const mx = createMx(store);
    store.start();
    const call = mx.mutate('join', {});
    await tick();
    expect(mutate).not.toHaveBeenCalled();
    answer({ tables: {}, errors: {}, mutationAccess: { join: null } });
    await expect(call).resolves.toMatchObject({ status: 'committed' });
    expect(mutate).toHaveBeenCalled();
    store.dispose();
  });
  it('a refusal that arrives with the answer is reported by its reason, not the placeholder', async () => {
    let answer!: (r: unknown) => void;
    const run = vi.fn().mockImplementation(() => new Promise(resolve => { answer = resolve; }));
    const store = createDataflowStore({ flow: writes }, { transport: { run, mutate: vi.fn(), page: vi.fn() } });
    const mx = createMx(store);
    store.start();
    const call = mx.mutate('join', {});
    await tick();
    answer({ tables: {}, errors: {}, mutationAccess: { join: 'a test user acts only inside its sandbox' } });
    await expect(call).rejects.toThrow('a test user acts only inside its sandbox');
    store.dispose();
  });
});

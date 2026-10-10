/**
 * The store's two Phase 2 seams (lib/page-store/store): the write lifecycle every write reports
 * (`subscribeWrites`, what the islands' status feed is built on) and another door's answer landing at
 * the versions it was asked at (`expectAnswer`, the viewer overlay's).
 */
import { describe, expect, it, vi } from 'vitest';
import { ACCESS_PENDING, createDataflowStore, type StoreWriteEvent } from '@/lib/page-store/store';
import type { CompiledDataflow } from '@/lib/dataflow';

const reads = (r: Partial<CompiledDataflow['queries'][number]['reads']> = {}) => ({ imports: [], queries: [], values: [], builtins: [], ...r });
const flow: CompiledDataflow = {
  imports: [{ name: 'd', ref: 'DS1', tables: [{ name: 'rows', columns: [{ name: 'n', type: 'number' }] }] }],
  values: [{ name: 'who', kind: 'scalar', type: 'string', default: 'anon' }],
  queries: [{ name: 'me', engine: 'sqlite', sql: 'select $who as v', params: [], reads: reads({ values: ['who'], builtins: ['_me.id'] }), columns: [{ name: 'v', type: 'string' }], start: 0, end: 0 }],
  mutations: [{ name: 'add', sql: 'insert into d.rows values ($who)', target: { import: 'd', table: 'rows' }, args: [{ name: 'who', type: 'string' }], reads: reads({ imports: ['d'], values: ['who'] }), start: 0, end: 0 }],
} as CompiledDataflow;
const table = (v: string) => ({ rows: [{ v }], columns: [{ name: 'v', type: 'string' as const }] });

describe('subscribeWrites', () => {
  it('reports a refused positional call as a write that failed, with the call as its retry; the wire form lets a pending check through to the server', async () => {
    const mutate = vi.fn().mockResolvedValue({ dataset: 'DS1' });
    const store = createDataflowStore({ flow }, { transport: { run: async () => ({ tables: {}, errors: {} }), page: async () => ({ rows: [], columns: [] }), mutate } });
    const events: StoreWriteEvent[] = [];
    store.subscribeWrites((e) => events.push(e));

    await expect(store.mutate('add', { who: 'jun' })).rejects.toThrow(ACCESS_PENDING);
    expect(mutate).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'write', id: 1, name: 'add' },
      { type: 'writeFailed', id: 1, name: 'add', error: new Error(ACCESS_PENDING), request: { mutation: 'add', args: { who: 'jun' } } },
    ]);

    await store.mutate({ mutation: 'add', args: { who: 'jun' } });
    expect(mutate).toHaveBeenCalledWith({ mutation: 'add', args: { who: 'jun' } });
    expect(events.slice(2)).toEqual([{ type: 'write', id: 2, name: 'add' }, { type: 'written', id: 2, name: 'add' }]);
  });

  it('hands a server refusal the request that was SENT, its arguments resolved from the page', async () => {
    const mutate = vi.fn().mockRejectedValue(new Error('Read-only'));
    const store = createDataflowStore({ flow, state: { values: { who: 'ana' }, tables: {}, errors: {}, mutationAccess: { add: null } } }, { transport: { run: async () => ({ tables: {}, errors: {}, mutationAccess: { add: null } }), page: async () => ({ rows: [], columns: [] }), mutate } });
    const events: StoreWriteEvent[] = [];
    store.subscribeWrites((e) => events.push(e));
    await store.mutate('add').catch(() => {});
    expect(events.at(-1)).toMatchObject({ type: 'writeFailed', name: 'add', request: { mutation: 'add', args: { who: 'ana' } } });
  });
});

describe('expectAnswer', () => {
  const store = () => createDataflowStore({ flow, results: { tables: {}, errors: {} } }, { transport: { run: () => new Promise(() => {}), page: async () => ({ rows: [], columns: [] }), mutate: async () => ({ dataset: 'DS1' }) } });

  it('lands the rows and write checks it names, for inputs that have not moved', () => {
    const s = store();
    expect(s.mutationUnavailable('add')).toBe(ACCESS_PENDING);
    const land = s.expectAnswer();
    land({ tables: { me: table('u1'), other: table('x') }, errors: {}, mutationAccess: { add: null } });
    expect(s.getTable('me')?.rows).toEqual([{ v: 'u1' }]);
    expect(s.getTable('other'), 'a name the document does not declare lands nowhere').toBeUndefined();
    expect(s.pending().has('me')).toBe(false);
    expect(s.mutationUnavailable('add')).toBeNull();
  });

  it('leaves a query whose input moved after the request left to its own run', () => {
    const s = store();
    const land = s.expectAnswer();
    s.setValue('who', 'bo');
    land({ tables: { me: table('u1-anon') }, errors: {} });
    expect(s.getTable('me')).toBeUndefined();
    expect(s.pending().has('me')).toBe(true);
  });
});

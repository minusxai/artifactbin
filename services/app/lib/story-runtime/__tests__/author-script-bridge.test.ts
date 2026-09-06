import { describe, expect, it, vi } from 'vitest';
import { createDataflowStore } from '../store';
import { createAuthorScriptBridge } from '../author-script-bridge';
import type { Dataflow } from '@/lib/story/dataflow';

const flow: Dataflow = {
  values: [{ kind: 'scalar', name: 'count', type: 'number', default: 0, start: 0, end: 0 }],
  queries: [],
};
const setup = () => {
  const store = createDataflowStore({ flow });
  return { store, bridge: createAuthorScriptBridge(store) };
};
describe('author script capability boundary', () => {
  it('sets a declared signal through the real store', async () => {
    const { store, bridge } = setup();
    expect(await bridge.request({ id: 1, op: 'set', name: 'count', value: 7 })).toEqual({ id: 1, ok: true });
    expect(store.getValue('count')).toBe(7);
  });
  it.each([
    { op: 'like' }, { op: 'follow' }, { op: 'edit', source: '<p>bad</p>' },
    { op: 'fetch', url: '/api/my/artifacts' }, { op: 'set', name: 'unknown', value: 1 },
    { op: 'set', name: '__proto__', value: 1 }, { op: 'set', name: 'count', value: 'wrong type' },
    { op: 'set', name: 'count', value: Infinity }, { op: 'set', name: 'count', value: {} },
    { op: 'refresh', names: ['/api/my/artifacts'] }, { op: 'mutate', name: 'undeclared' },
  ])('rejects %j without changing the store', async message => {
    const { store, bridge } = setup();
    const before = store.getState();
    expect(await bridge.request({ id: 2, ...message })).toMatchObject({ id: 2, ok: false });
    expect(store.getState()).toBe(before);
  });
  it.each([null, [], 'bad', { id: -1, op: 'refresh' }, { id: 1.2, op: 'refresh' }])('fails closed on malformed envelopes: %j', async message => {
    expect(await setup().bridge.request(message)).toMatchObject({ ok: false });
  });
  it('uses current declarations after a document replacement', async () => {
    const { store, bridge } = setup();
    store.replaceFlow({ flow: { values: [], queries: [] } });
    expect(await bridge.request({ id: 3, op: 'set', name: 'count', value: 1 })).toMatchObject({ ok: false });
  });
  it('revokes the channel on dispose', async () => {
    const { store, bridge } = setup();
    bridge.dispose();
    expect(await bridge.request({ id: 4, op: 'set', name: 'count', value: 1 })).toMatchObject({ ok: false });
    expect(store.getValue('count')).toBe(0);
  });
  it('never invents a mutation or bypasses store permission checks', async () => {
    const { store, bridge } = setup();
    const mutate = vi.spyOn(store, 'mutate');
    expect(await bridge.request({ id: 5, op: 'mutate', name: 'anything' })).toMatchObject({ ok: false });
    expect(mutate).not.toHaveBeenCalled();
  });
  it('refuses replays without repeating a signal write', async () => {
    const { store, bridge } = setup();
    expect(await bridge.request({ id: 1, op: 'set', name: 'count', value: 1 })).toMatchObject({ ok: true });
    expect(await bridge.request({ id: 1, op: 'set', name: 'count', value: 2 })).toMatchObject({ ok: false });
    expect(store.getValue('count')).toBe(1);
  });
  it('bounds request bursts', async () => {
    const { bridge } = setup();
    vi.spyOn(Date, 'now').mockReturnValue(1);
    try {
      for (let id = 1; id <= 120; id++) expect(await bridge.request({ id, op: 'refresh' })).toMatchObject({ ok: true });
      expect(await bridge.request({ id: 121, op: 'refresh' })).toMatchObject({ ok: false });
    } finally { vi.restoreAllMocks(); }
  });
  it('runs an allowed declared mutation through the real permission-checked store', async () => {
    const mutate = vi.fn(async () => ({ dataset: 'owned' }));
    const mutations = [{ name: 'save', sql: 'update ref_owned set n=$count', params: ['count'], target: 'owned', refs: ['owned'], start: 0, end: 0 }];
    const store = createDataflowStore({ flow: { ...flow, mutations }, state: { values: { count: 0 }, tables: {}, errors: {}, mutationAccess: { save: null } } }, {
      transport: { mutate, run: async () => ({ tables: {}, errors: {} }), page: async () => ({ rows: [], columns: [] }) },
    });
    const bridge = createAuthorScriptBridge(store);
    expect(await bridge.request({ id: 1, op: 'mutate', name: 'save', values: { count: 9 } })).toMatchObject({ ok: true });
    expect(mutate).toHaveBeenCalledWith({ count: 9 }, 'save');
    store.replaceFlow({ flow: { ...flow, mutations }, state: { values: { count: 0 }, tables: {}, errors: {}, mutationAccess: { save: 'No edit access' } } });
    expect(await bridge.request({ id: 2, op: 'mutate', name: 'save' })).toMatchObject({ ok: false });
    expect(mutate).toHaveBeenCalledTimes(1);
    bridge.dispose();
  });
});

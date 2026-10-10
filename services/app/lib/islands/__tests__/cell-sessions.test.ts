import { describe, expect, it, vi } from 'vitest';
import { createCellSessions } from '../cell-sessions';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('observable cell sessions', () => {
  it('preserves null drafts and the original row across refresh and remount', () => {
    const store = createCellSessions();
    const row = { id: 1, status: 'todo' };
    store.begin('a', 'todo', row);
    const first = store.get('a');
    expect(store.get('a')).toBe(first);
    row.status = 'external';
    store.change('a', null);
    const edited = store.get('a');
    store.begin('a', 'external', row);
    expect(store.get('a')).toBe(edited);
    expect(edited).toMatchObject({ draft: null, original: 'todo', row: { id: 1, status: 'todo' }, phase: 'editing' });
  });

  it('notifies subscribers only when a snapshot changes and honors unsubscribe', () => {
    const store = createCellSessions();
    const notify = vi.fn();
    const unsubscribe = store.subscribe(notify);
    store.begin('a', 1, {});
    expect(notify).toHaveBeenCalledTimes(1);
    const snapshot = store.get('a');
    store.begin('a', 2, {});
    store.change('a', 1);
    store.reconcile('a', 1);
    expect(store.get('a')).toBe(snapshot);
    expect(notify).toHaveBeenCalledTimes(1);
    store.change('a', 2);
    expect(notify).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.cancel('a');
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('deduplicates pending and saved commits and passes invocation snapshots', async () => {
    const store = createCellSessions(); const wait = deferred();
    const write = vi.fn(() => wait.promise);
    store.begin('a', 'old', { id: 1 });
    store.change('a', 'new');
    const commit = store.commit('a', write);
    expect(store.get('a')?.phase).toBe('pending');
    store.change('a', 'ignored');
    await store.commit('a', write);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('new', 'old', { id: 1 });
    wait.resolve(); await commit;
    expect(store.get('a')).toMatchObject({ phase: 'saved', draft: 'new' });
    await store.commit('a', write);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('makes Escape followed by blur a no-op and never creates implicit sessions', async () => {
    const store = createCellSessions(); const write = vi.fn();
    store.change('absent', null);
    await store.commit('absent', write);
    store.begin('a', 'old', {});
    store.change('a', 'new');
    store.cancel('a');
    await store.commit('a', write);
    expect(write).not.toHaveBeenCalled();
    expect(store.get('a')).toBeUndefined();
    expect(store.get('absent')).toBeUndefined();
  });

  it('notifies remounted subscribers when an in-flight write completes', async () => {
    const store = createCellSessions(); const wait = deferred();
    const unmount = store.subscribe(vi.fn());
    store.begin('a', 0, {});
    store.change('a', 1);
    const commit = store.commit('a', () => wait.promise);
    unmount();
    const remounted = vi.fn(); store.subscribe(remounted);
    wait.resolve(); await commit;
    expect(remounted).toHaveBeenCalledTimes(1);
    expect(store.get('a')?.phase).toBe('saved');
  });

  it.each(['resolve', 'reject'] as const)('ignores stale async %s after cancellation and a new edit', async (outcome) => {
    const store = createCellSessions(); const wait = deferred();
    store.begin('a', 'old', {});
    store.change('a', 'new');
    const commit = store.commit('a', () => wait.promise);
    store.cancel('a');
    store.begin('a', 'fresh', { id: 2 });
    const fresh = store.get('a');
    if (outcome === 'resolve') wait.resolve(); else wait.reject(new Error('stale error'));
    await commit;
    expect(store.get('a')).toBe(fresh);
  });

  it('retains failed drafts and original snapshots for explicit retry', async () => {
    const store = createCellSessions();
    store.begin('a', false, { id: 1 });
    store.change('a', true);
    await store.commit('a', async () => { throw new Error('conflict'); });
    expect(store.get('a')).toMatchObject({phase: 'error', error: 'conflict', draft: true, original: false});
    const write = vi.fn(async () => {});
    await store.commit('a', write);
    expect(write).toHaveBeenCalledWith(true, false, {id: 1});
    expect(store.get('a')).toMatchObject({ phase: 'saved', error: null });
  });

  it('keeps saved overlays until matching authoritative data arrives', async () => {
    const store = createCellSessions();
    store.begin('a', 'old', {}); store.change('a', null);
    await store.commit('a', async () => {});
    const saved = store.get('a');
    store.reconcile('a', 'old');
    expect(store.get('a')).toBe(saved);
    store.reconcile('a', null);
    expect(store.get('a')).toBeUndefined();
  });

  it('drops an unchanged edit without sending a mutation', async () => {
    const store = createCellSessions(); const write = vi.fn();
    store.begin('a', null, {});
    await store.commit('a', write);
    expect(write).not.toHaveBeenCalled();
    expect(store.get('a')).toBeUndefined();
  });

  it('keeps unrelated cells isolated while edits and writes overlap', async () => {
    const store = createCellSessions(); const wait = deferred();
    store.begin('a', 1, {}); store.begin('b', 2, {});
    store.change('a', 4);
    const commit = store.commit('a', () => wait.promise);
    store.change('b', 3);
    const b = store.get('b');
    wait.resolve(); await commit;
    expect(store.get('b')).toBe(b);
    expect(b?.draft).toBe(3);
  });
});

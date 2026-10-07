import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorSource } from '../create-editor-source';
import { renderHook } from '@/solid/__tests__/helpers';
import type { PendingChange } from '../create-live-edits';

const a = '<div><p id="a">one</p><p id="b">two</p><p id="c">three</p></div>';

function setup(initial = a, commitPending: () => Promise<void> = async () => {}) {
  const queued: PendingChange[] = [];
  const drawn: Array<{ source: string; editId?: string }> = [];
  const { result: store } = renderHook(() => createEditorSource({
    initial,
    live: { queue: (change) => queued.push(change) },
    draw: (source, editId) => drawn.push(editId === undefined ? { source } : { source, editId }),
    commitPending,
  }));
  return { store, queued, drawn };
}

afterEach(() => vi.useRealTimers());

it('a local apply records one undo entry, queues once, and draws only when asked', () => {
  const { store, queued, drawn } = setup();
  const typed = a.replace('one', 'one!');
  const annotationOperation = { id: 'note-1', kind: 'create' } as never;
  store.apply(typed, { origin: 'local', selection: { annotationOperation } });
  expect(store.source()).toBe(typed);
  expect(store.current()).toBe(typed);
  expect(store.canUndo()).toBe(true);
  expect(queued).toEqual([{ source: typed, annotationOps: [annotationOperation] }]);
  expect(drawn).toEqual([]);
  expect(store.revision()).toBe(0);

  const moved = typed.replace('two', 'TWO');
  store.apply(moved, { origin: 'structural', redraw: true });
  expect(queued).toHaveLength(2);
  expect(queued[1]).toEqual({ source: moved });
  expect(drawn).toEqual([{ source: moved }]);

  // The same source again is not a change: nothing recorded, queued or drawn.
  store.apply(moved, { origin: 'structural', redraw: true });
  expect(queued).toHaveLength(2);
  expect(drawn).toHaveLength(1);
});

it('one undo reverses exactly one local apply', async () => {
  const { store } = setup();
  const first = a.replace('one', 'uno');
  const second = first.replace('three', 'tres');
  store.apply(first, { origin: 'local' });
  store.apply(second, { origin: 'local' });
  expect(await store.undo()).toMatchObject({ ok: true, source: first });
  expect(store.source()).toBe(first);
  expect(store.canUndo()).toBe(true);
  expect(store.canRedo()).toBe(true);
});

it('a remote replace bumps the revision, is never recorded, and leaves undo usable', async () => {
  const { store, queued, drawn } = setup();
  const typed = a.replace('one', 'mine');
  store.apply(typed, { origin: 'local' });
  queued.length = 0;

  const remote = typed.replace('three', 'theirs');
  store.replaceFromRemote(remote, 'edit-remote');
  expect(store.source()).toBe(remote);
  expect(store.revision()).toBe(1);
  expect(drawn).toEqual([{ source: remote, editId: 'edit-remote' }]);
  // The server already holds it: a remote document is not queued back.
  expect(queued).toEqual([]);

  const undone = await store.undo();
  expect(undone).toEqual({ ok: true, source: a.replace('three', 'theirs') });
  expect(store.source()).toBe(a.replace('three', 'theirs'));
  expect(store.revision()).toBe(2);
  expect(queued).toEqual([{ source: a.replace('three', 'theirs') }]);
  // Only the local edit was ever an undo step.
  expect(store.canUndo()).toBe(false);
  expect(await store.undo()).toEqual({ ok: false, reason: 'empty' });
});

it('an undo that conflicts with a remote edit says so and leaves the source unchanged', async () => {
  const { store, queued, drawn } = setup();
  store.apply(a.replace('one', 'mine'), { origin: 'local' });
  const remote = a.replace('one', 'theirs');
  store.replaceFromRemote(remote, 'edit-remote');
  queued.length = 0;
  drawn.length = 0;
  const revision = store.revision();

  expect(await store.undo()).toEqual({ ok: false, reason: 'conflict' });
  expect(store.source()).toBe(remote);
  expect(store.current()).toBe(remote);
  expect(store.revision()).toBe(revision);
  expect(queued).toEqual([]);
  expect(drawn).toEqual([]);
  expect(store.canUndo()).toBe(true);
});

it('grouped applies within 750 ms collapse into one undo; later ones do not', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-01T00:00:00Z'));
  const { store } = setup();
  const b = a.replace('one', 'onex');
  const c = a.replace('one', 'onexy');
  const d = a.replace('one', 'onexyz');
  store.apply(b, { origin: 'local', group: 'typing:a' });
  vi.advanceTimersByTime(300);
  store.apply(c, { origin: 'local', group: 'typing:a' });
  vi.advanceTimersByTime(800);
  store.apply(d, { origin: 'local', group: 'typing:a' });

  expect(await store.undo()).toMatchObject({ ok: true, source: c });
  expect(await store.undo()).toMatchObject({ ok: true, source: a });
  expect(store.canUndo()).toBe(false);
});

it('undo commits pending typing first, and says the editor is unavailable when that fails', async () => {
  const order: string[] = [];
  let fail = false;
  const { store } = setup(a, async () => { order.push('commit'); if (fail) throw new Error('Editor is gone.'); });
  store.apply(a.replace('one', 'uno'), { origin: 'local' });
  await store.undo();
  expect(order).toEqual(['commit']);
  expect(store.source()).toBe(a);

  store.apply(a.replace('two', 'dos'), { origin: 'local' });
  fail = true;
  expect(await store.undo()).toEqual({ ok: false, reason: 'unavailable', message: 'Editor is gone.' });
  expect(store.source()).toBe(a.replace('two', 'dos'));
});

it('redo after undo restores the change, draws it and queues it with its annotation operations', async () => {
  const { store, queued, drawn } = setup();
  const typed = a.replace('two', 'zwei');
  store.apply(typed, { origin: 'local' });
  await store.undo();
  queued.length = 0;
  drawn.length = 0;
  expect(await store.redo()).toMatchObject({ ok: true, source: typed });
  expect(store.source()).toBe(typed);
  expect(queued).toEqual([{ source: typed }]);
  expect(drawn).toEqual([{ source: typed }]);
  expect(store.canRedo()).toBe(false);
});


describe('collaborative Markdown history', () => {
  const before = '<article id="doc"><p id="a">local</p><p id="b">remote</p></article>';
  it.each([
    ['heading', '<h2 id="a">local</h2>'],
    ['bold', '<p id="a"><strong>local</strong></p>'],
    ['italic', '<p id="a"><em>local</em></p>'],
    ['list', '<ul id="list"><li id="item"><p id="a">local</p></li></ul>'],
    ['quote', '<blockquote id="quote"><p id="a">local</p></blockquote>'],
    ['code', '<pre id="a">local</pre>'],
    ['split', '<p id="a">lo</p><p id="new">cal</p>'],
  ])('undoes and redoes a local %s while preserving remote prose and insertions', async (_name, replacement) => {
    const { store, queued } = setup(before);
    const local = before.replace('<p id="a">local</p>', replacement);
    store.apply(local, { origin: 'local' });
    const remote = local.replace('<p id="b">remote</p>', '<p id="b">their text</p><p id="c">their new block</p>');
    store.replaceFromRemote(remote, 'remote-1');
    queued.length = 0;
    const expectedUndo = remote.replace(replacement, '<p id="a">local</p>');
    expect(await store.undo()).toMatchObject({ ok: true, source: expectedUndo });
    expect(await store.redo()).toMatchObject({ ok: true, source: remote });
    expect(store.current()).toBe(remote);
    expect(queued.map(change => change.source)).toEqual([expectedUndo, remote]);
  });

  it('preserves a conflicting remote deletion and leaves the local undo entry available', async () => {
    const { store, queued } = setup(before);
    store.apply(before.replace('>local<', '><strong>local</strong><'), { origin: 'local' });
    const deleted = '<article id="doc"><p id="b">remote</p></article>';
    store.replaceFromRemote(deleted, 'remote-delete');
    queued.length = 0;
    expect(await store.undo()).toEqual({ ok: false, reason: 'conflict' });
    expect(store.current()).toBe(deleted);
    expect(store.canUndo()).toBe(true);
    expect(queued).toEqual([]);
  });

  it('does not let a delayed typing publish resurrect a document replaced remotely', () => {
    vi.useFakeTimers();
    const { store, queued } = setup(before);
    store.apply(before.replace('>local<', '>typed<'), { origin: 'local', group: 'typing:a' });
    const remote = before.replace('>local<', '>server text<');
    store.replaceFromRemote(remote, 'remote-during-rest');
    vi.advanceTimersByTime(1000);
    expect(store.current()).toBe(remote);
    expect(store.source()).toBe(remote);
    expect(queued).toHaveLength(1);
  });
});

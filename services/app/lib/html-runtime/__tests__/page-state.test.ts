import { expect, it, vi } from 'vitest';
import type { HtmlJsonObject } from '@artifactbin/contracts';
import { createPageState, type PageStateOptions } from '../page-state';
import { createStateStore } from '../state-store';
import { createLocalStore } from '../apollo/local-store';
import { encodeState } from '../apollo/state-url';
// The one GraphQL import: gql interop with the store (old pages read the same document).
import { createClient, gql } from '../apollo/graphql-compat';
import type { StatePort } from '../apollo/apollo-contracts';
import { createHtmlCommentViewSession, withHtmlCommentView } from '../../html-bridge/comment-view-session';

/** One viewer's browser: a shared localStorage, a `storage` event to other tabs and a page-origin lock. */
function browser() {
  const items = new Map<string, string>();
  const tabs = new Set<(key: string | null) => void>();
  let queue = Promise.resolve();
  const tab = (overrides: Partial<PageStateOptions> = {}): PageStateOptions => {
    const own = new Set<(key: string | null) => void>();
    return {
      pageId: 'p1', initial: { count: 0 }, hash: '', backends: [], owner: {},
      storage: { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => { items.set(key, value); } },
      onStorage(listener) { own.add(listener); tabs.add(listener); return () => { own.delete(listener); tabs.delete(listener); }; },
      lock: (_name, work) => { const next = queue.then(work); queue = next.then(() => {}, () => {}); return next; },
      ...overrides,
    };
  };
  // A browser fires `storage` in every other tab after a write; tests deliver it explicitly.
  return { items, tab, deliver: (key: string | null = 'af:viewer:v2:p1') => tabs.forEach((listener) => listener(key)) };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** What the browser keeps for a page: only the viewer's overrides of its defaults. */
const saved = (items: Map<string, string>, key = 'af:viewer:v2:p1') => JSON.parse(items.get(key)!).overrides;

it('is a Zustand vanilla store: getState, setState(partial | fn) and subscribe, which never fires on the current value', async () => {
  const { state } = createPageState(browser().tab());
  expect(Object.keys(state).sort()).toEqual(expect.arrayContaining(['getInitialState', 'getState', 'persist', 'setState', 'subscribe']));
  const listener = vi.fn();
  state.subscribe(listener);
  expect(listener).not.toHaveBeenCalled();
  expect(state.getState()).toEqual({ count: 0 });
  const before = state.getState();
  state.setState({ count: 1 });
  expect(state.getState()).toEqual({ count: 1 });
  expect(listener).toHaveBeenLastCalledWith({ count: 1 }, before);
  state.setState((current) => ({ count: (current.count as number) + 1, label: 'two' }));
  expect(state.getState()).toEqual({ count: 2, label: 'two' });
  state.setState({ label: 'only' }, true);
  expect(state.getState()).toEqual({ label: 'only' });
  await settle();
  // `count` has a default: removing it brings the default back once the write lands (./viewer-overrides).
  expect(state.getState()).toEqual({ count: 0, label: 'only' });
  expect(listener).toHaveBeenCalledTimes(4);
});

it('persists per viewer across a reload, and the saved document wins over the state block defaults', async () => {
  const viewer = browser();
  const first = createPageState(viewer.tab({ initial: { count: 0, theme: 'light' } }));
  await first.state.setState({ count: 4 });
  expect(saved(viewer.items)).toEqual({ count: 4 });
  first.dispose();
  const reloaded = createPageState(viewer.tab({ initial: { count: 0, theme: 'light' } }));
  expect(reloaded.state.getState()).toEqual({ count: 4, theme: 'light' });
  expect(reloaded.state.getInitialState()).toEqual({ count: 0, theme: 'light' });
  // Another page keeps its own document.
  expect(createPageState(viewer.tab({ pageId: 'p2' })).state.getState()).toEqual({ count: 0 });
});

it('syncs another tab of the same viewer through StatePort.subscribe, firing only on a real change', async () => {
  const viewer = browser();
  const a = createPageState(viewer.tab());
  const b = createPageState(viewer.tab());
  const seen = vi.fn();
  b.state.subscribe(seen);
  await a.state.setState({ count: 5 });
  expect(b.state.getState()).toEqual({ count: 0 });
  viewer.deliver();
  expect(b.state.getState()).toEqual({ count: 5 });
  expect(seen).toHaveBeenCalledTimes(1);
  viewer.deliver();
  viewer.deliver('some-other-key');
  expect(seen).toHaveBeenCalledTimes(1);
});

it('a setState from a tab that has not seen another tab\'s write applies on the newest document', async () => {
  const viewer = browser();
  const a = createPageState(viewer.tab());
  const b = createPageState(viewer.tab());
  await a.state.setState((s) => ({ count: (s.count as number) + 1 }));
  // b still shows 0 (no storage event yet); its increment must not overwrite a's.
  await b.state.setState((s) => ({ count: (s.count as number) + 1 }));
  expect(saved(viewer.items)).toEqual({ count: 2 });
  expect(b.state.getState()).toEqual({ count: 2 });
});

it('compare-and-swap: a setState whose write conflicts re-applies on the new document', async () => {
  const shared = createLocalStore({ count: 10, other: 'x' });
  let interleaved = false;
  // Another tab commits between this tab's read and its write: the first write meets a conflict.
  const port: StatePort = { read: shared.read, subscribe: shared.subscribe, async write(change) {
    if (!interleaved) { interleaved = true; await shared.write({ expected: { count: 10 }, next: { count: 20 } }); }
    return shared.write(change);
  } };
  const state = createStateStore(port, { initial: { count: 0 } });
  const increment = vi.fn((s: HtmlJsonObject) => ({ count: (s.count as number) + 1 }));
  await state.setState(increment);
  expect(shared.read()).toEqual({ count: 21, other: 'x' });
  expect(state.getState()).toEqual({ count: 21, other: 'x' });
  expect(increment.mock.calls.map(([s]) => s.count)).toEqual([10, 20]);
  // An object partial re-applies too, and a write that no longer changes anything sends nothing.
  await state.setState({ count: 21 });
  expect(shared.read()).toEqual({ count: 21, other: 'x' });
});

it('two tabs incrementing at once both land', async () => {
  const viewer = browser();
  const a = createPageState(viewer.tab());
  const b = createPageState(viewer.tab());
  await Promise.all([a.state.setState((s) => ({ count: (s.count as number) + 1 })), b.state.setState((s) => ({ count: (s.count as number) + 1 }))]);
  expect(saved(viewer.items).count).toBe(2);
});

it('refuses values the document cannot store, synchronously, and keeps the store unchanged', () => {
  const { state, port } = createPageState(browser().tab());
  expect(() => state.setState({ when: new Date() } as never)).toThrow(TypeError);
  expect(() => state.setState({ run: () => 1 } as never)).toThrow(TypeError);
  expect(() => state.setState(null as never)).toThrow(TypeError);
  expect(state.getState()).toEqual({ count: 0 });
  expect(port.read()).toEqual({ count: 0 });
});

it('an #af-state link seeds the store and replaces this viewer\'s saved document', async () => {
  const viewer = browser();
  await createPageState(viewer.tab()).state.setState({ count: 9 });
  const seeded = createPageState(viewer.tab({ hash: '#af-state=' + encodeState({ count: 3, tab: 'detail' }) }));
  expect(seeded.state.getState()).toEqual({ count: 3, tab: 'detail' });
  await settle();
  expect(saved(viewer.items)).toEqual({ count: 3, tab: 'detail' });
});

it('an #af-state that arrives after load (the app forwards its address\'s fragment) seeds the store once, telling subscribers', async () => {
  const viewer = browser();
  let hashChanged: ((hash: string) => void) | undefined;
  const page = createPageState(viewer.tab({ initial: { count: 0, tab: 'home' }, onHash: (listener) => { hashChanged = listener; return () => { hashChanged = undefined; }; } }));
  await page.state.setState({ count: 9 });
  const seen = vi.fn();
  page.state.subscribe(seen);
  hashChanged!('#top');
  expect(seen).not.toHaveBeenCalled();
  hashChanged!('#af-state=' + encodeState({ tab: 'detail' }));
  expect(page.state.getState()).toEqual({ count: 0, tab: 'detail' });
  expect(seen).toHaveBeenCalledTimes(1);
  await settle();
  expect(saved(viewer.items)).toEqual({ tab: 'detail' });
  hashChanged!('#af-state=***');
  expect(page.state.getState()).toEqual({ count: 0, tab: 'detail' });
  page.dispose();
  expect(hashChanged).toBeUndefined();
});

it('comment views capture and restore the same document the store holds', async () => {
  const owner = {};
  const { state, port } = createPageState(browser().tab({ owner, stateBlock: { getAttribute: () => null }, initial: { screen: 'home', count: 0 } }));
  state.setState({ screen: 'detail' });
  await settle();
  const captured = withHtmlCommentView(owner, {}).viewState;
  expect(captured).toMatchObject({ state: { $html: { fields: { screen: 'detail' } } } });
  state.setState({ screen: 'elsewhere' });
  await settle();
  const seen = vi.fn();
  state.subscribe(seen);
  await createHtmlCommentViewSession(owner).receive({ openId: 'c', pins: [{ id: 'c', viewState: captured! }] });
  expect(port.read().screen).toBe('detail');
  expect(state.getState().screen).toBe('detail');
  expect(seen).toHaveBeenCalled();
});

it('gql local state and the store are one document, in both directions', async () => {
  const { state, port } = createPageState(browser().tab({ initial: { count: 0, name: 'a' } }));
  const client = createClient({ backends: [], state: port });
  const query = gql`{count name}`;
  const watched = vi.fn();
  client.watchQuery({ query }).subscribe(({ data }) => watched(data));
  await state.setState({ count: 7 });
  expect((await client.query({ query })).data).toEqual({ count: 7, name: 'a' });
  expect(watched).toHaveBeenLastCalledWith({ count: 7, name: 'a' });
  await client.updateQuery({ query: gql`{name}` }, () => ({ name: 'b' }));
  expect(state.getState()).toEqual({ count: 7, name: 'b' });
});

it('offline and exported copies keep the same contract in their own browser storage, keyed by the copy\'s page id', async () => {
  // A downloaded copy's runtime block names the page id (or `local:<path>` when it carries none); its origin's
  // localStorage holds that viewer's document, seeded from the copy's state block (which carries any saved private state).
  const viewer = browser();
  const { state } = createPageState(viewer.tab({ pageId: 'local:/report.html', initial: { filter: 'mine' } }));
  expect(state.getState()).toEqual({ filter: 'mine' });
  await state.setState({ filter: 'all' });
  expect(saved(viewer.items, 'af:viewer:v2:local:/report.html')).toEqual({ filter: 'all' });
});

it('keeps working in memory when browser storage is denied', async () => {
  const { state, port } = createPageState(browser().tab({ storage: { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } } }));
  await state.setState({ count: 1 });
  expect(state.getState()).toEqual({ count: 1 });
  expect(port.read()).toEqual({ count: 1 });
});

it('review: subscriber setState preserves partial intent across a competing write', async () => {
  const shared = createLocalStore({ a: 0, b: 0, other: 0 });
  let interleaved = false;
  const port: StatePort = {
    read: shared.read, subscribe: shared.subscribe,
    async write(change) {
      const result = await shared.write(change);
      if (!interleaved && result.status === 'committed') {
        interleaved = true;
        await shared.write({ expected: { other: 0 }, next: { other: 99 } });
      }
      return result;
    },
  };
  const state = createStateStore(port);
  let nested: Promise<void> | undefined;
  state.subscribe((s) => { if (s.a === 1 && s.b === 0) nested = state.setState({ b: 1 }); });
  await state.setState({ a: 1 });
  await nested;
  expect(shared.read()).toEqual({ a: 1, b: 1, other: 99 });
});

it('keeps a JSON __proto__ field an own field through state.setState, storage and a reload', async () => {
  const viewer = browser();
  const { state } = createPageState(viewer.tab());
  await state.setState(JSON.parse('{"__proto__":{"chosen":true}}'));
  for (const current of [state.getState(), createPageState(viewer.tab()).state.getState()]) {
    expect(Object.getPrototypeOf(current)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(current, '__proto__')?.value).toEqual({ chosen: true });
    expect((current as { chosen?: unknown }).chosen).toBeUndefined();
  }
  expect(Object.getOwnPropertyDescriptor(saved(viewer.items), '__proto__')?.value).toEqual({ chosen: true });
});

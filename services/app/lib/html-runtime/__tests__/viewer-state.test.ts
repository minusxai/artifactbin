import { expect, it } from 'vitest';
import { createViewerState } from '../viewer-state';
import type { ViewerStateOptions } from '../viewer-state-contract';
function browser() {
  let value: string | null = null;
  const listeners = new Set<() => void>();
  let queue = Promise.resolve();
  const options: ViewerStateOptions = {
    storage: { read: () => value, write: (next) => { value = next; } },
    observe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    lock: (work) => { const next = queue.then(work); queue = next.then(() => {}, () => {}); return next; },
  };
  return { options, notify: () => listeners.forEach((listener) => listener()), value: () => value };
}
it('serializes compare-and-swap between tabs and publishes viewer-only storage changes', async () => {
  const storage = browser();
  const first = createViewerState({ ...storage.options, initial: { count: 0 } });
  const second = createViewerState({ ...storage.options, initial: { count: 0 } });
  const seen: unknown[] = [];
  second.subscribe((state) => seen.push(state));
  const [a, b] = await Promise.all([first.write({ expected: { count: 0 }, next: { count: 1 } }), second.write({ expected: { count: 0 }, next: { count: 2 } })]);
  expect(a.status).toBe('committed'); expect(b.status).toBe('conflict');
  storage.notify(); expect(seen.at(-1)).toEqual({ count: 1 });
  expect(second.read()).toEqual({ count: 1 });
  expect(storage.value()).toBe('{"count":1}');
  first.dispose(); second.dispose();
});
it('keeps working privately in memory when browser persistence is unavailable', async () => {
  const state = createViewerState({ storage: { read: () => { throw new Error('denied'); }, write: () => { throw new Error('denied'); } }, observe: () => () => {}, initial: { count: 0 } });
  expect((await state.write({ expected: { count: 0 }, next: { count: 1 } })).status).toBe('committed');
  expect(state.read()).toEqual({ count: 1 });
  state.dispose();
});
it('does not lose a memory commit to an older persisted document after quota failure', async () => {
  const state = createViewerState({ storage: { read: () => '{"count":0}', write: () => { throw new Error('quota'); } }, observe: () => () => {}, lock: async () => { throw new Error('locks unavailable'); } });
  expect((await state.write({ expected: { count: 0 }, next: { count: 1 } })).status).toBe('committed');
  expect(state.read()).toEqual({ count: 1 });
  state.dispose();
});
it('an explicit state URL replaces the viewer document without sharing it', () => {
  const storage = browser();
  storage.options.storage.write('{"old":true}');
  const state = createViewerState({ ...storage.options, initial: { count: 7 }, replaceInitial: true });
  expect(state.read()).toEqual({ count: 7 });
  expect(storage.value()).toBe('{"count":7}');
  state.dispose();
});
it('answers the first query after a reload with the saved choice, not the state block defaults', async () => {
  const { createClient, gql } = await import('../apollo/client');
  const storage = browser();
  const preference = gql`{dark month}`;
  // First load: the viewer turns dark mode on.
  const before = createViewerState({ ...storage.options, initial: { dark: null, month: '' } });
  await createClient({ backends: () => [], state: before }).updateQuery({ query: preference }, () => ({ dark: true, month: '2026-09' }));
  before.dispose();
  // Reload: a page that fills in only missing values at boot keeps the saved ones, because the first answer is the saved document.
  const after = createViewerState({ ...storage.options, initial: { dark: null, month: '' } });
  const client = createClient({ backends: () => [], state: after });
  const { data } = await client.query<{ dark: boolean | null; month: string }>({ query: preference });
  expect(data).toEqual({ dark: true, month: '2026-09' });
  await client.updateQuery<{ dark: boolean | null; month: string }>({ query: preference }, (current) => ({ dark: current.dark ?? false, month: current.month || '2026-10' }));
  expect(JSON.parse(storage.value()!)).toEqual({ dark: true, month: '2026-09' });
  after.dispose();
});

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
  const first = createViewerState({ ...storage.options, defaults: { count: 0 } });
  const second = createViewerState({ ...storage.options, defaults: { count: 0 } });
  const seen: unknown[] = [];
  second.subscribe((state) => seen.push(state));
  const [a, b] = await Promise.all([first.write({ expected: { count: 0 }, next: { count: 1 } }), second.write({ expected: { count: 0 }, next: { count: 2 } })]);
  expect(a.status).toBe('committed'); expect(b.status).toBe('conflict');
  storage.notify(); expect(seen.at(-1)).toEqual({ count: 1 });
  expect(second.read()).toEqual({ count: 1 });
  expect(JSON.parse(storage.value()!)).toEqual({ $af: 'overrides', version: null, revision: null, overrides: { count: 1 } });
  first.dispose(); second.dispose();
});
it('keeps working privately in memory when browser persistence is unavailable', async () => {
  const state = createViewerState({ storage: { read: () => { throw new Error('denied'); }, write: () => { throw new Error('denied'); } }, observe: () => () => {}, defaults: { count: 0 } });
  expect((await state.write({ expected: { count: 0 }, next: { count: 1 } })).status).toBe('committed');
  expect(state.read()).toEqual({ count: 1 });
  state.dispose();
});
it('does not lose a memory commit to an older persisted document after quota failure', async () => {
  const state = createViewerState({ storage: { read: () => '{"$af":"overrides","version":null,"revision":null,"overrides":{"count":0}}', write: () => { throw new Error('quota'); } }, observe: () => () => {}, lock: async () => { throw new Error('locks unavailable'); } });
  expect((await state.write({ expected: { count: 0 }, next: { count: 1 } })).status).toBe('committed');
  expect(state.read()).toEqual({ count: 1 });
  state.dispose();
});
it('an explicit state URL replaces the viewer document without sharing it', async () => {
  const storage = browser();
  storage.options.storage.write('{"$af":"overrides","version":null,"revision":null,"overrides":{"old":true}}');
  const state = createViewerState({ ...storage.options, defaults: { count: 0 }, seed: { count: 7 } });
  expect(state.read()).toEqual({ count: 7 });
  // Persisted under the page lock, like any write: a write queued behind it runs once it has.
  await state.write({ expected: {}, next: {} });
  expect(JSON.parse(storage.value()!)).toEqual({ $af: 'overrides', version: null, revision: null, overrides: { count: 7 } });
  state.dispose();
});
it('review: a fragment seed cannot bypass an in-flight revision lock', async () => {
  const storage = browser();
  let seeded = false;
  const older = createViewerState({ ...storage.options, defaults: { count: 0 }, revision: '2',
    lock: async (work) => {
      const pending = work(); // work has read revision 2 and is awaiting its local CAS
      if (!seeded) {
        seeded = true;
        createViewerState({ ...storage.options, defaults: { count: 0 }, revision: '3', seed: { count: 30 } });
      }
      return pending;
    },
  });
  await older.write({ expected: { count: 0 }, next: { count: 20 } });
  expect(JSON.parse(storage.value()!)).toMatchObject({ revision: '3', overrides: { count: 30 } });
});

it('review: preserves a storable JSON __proto__ field as an own field', async () => {
  const storage = browser();
  const page = createViewerState({ ...storage.options, defaults: {} });
  const receipt = await page.write({ expected: {}, next: JSON.parse('{"__proto__":{"chosen":true}}') });
  expect(receipt.status).toBe('committed');
  expect(Object.hasOwn(page.read(), '__proto__')).toBe(true);
  expect(Object.getPrototypeOf(page.read())).toBe(Object.prototype);
});

it('review: an empty corrupt v2 entry is never overwritten', async () => {
  const storage = browser();
  storage.options.storage.write('');
  const page = createViewerState({ ...storage.options, defaults: { count: 0 } });
  await page.write({ expected: { count: 0 }, next: { count: 1 } });
  expect(page.read()).toEqual({ count: 1 });
  expect(storage.value()).toBe('');
});

it('never saves over a newer revision that another tab committed between this write\'s read and its save (no shared lock)', async () => {
  const storage = browser();
  const newer = '{"$af":"overrides","version":null,"revision":"3","overrides":{"count":30}}';
  const older = createViewerState({ ...storage.options, defaults: { count: 0 }, revision: '2',
    // No Web Locks (an insecure origin): another tab commits while this write is in flight.
    lock: async (work) => { const pending = work(); storage.options.storage.write(newer); return pending; },
  });
  const receipt = await older.write({ expected: { count: 0 }, next: { count: 20 } });
  expect(receipt.status).toBe('rejected');
  expect(storage.value()).toBe(newer);
});

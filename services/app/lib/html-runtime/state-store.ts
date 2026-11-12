/**
 * `@afbin/state`'s store: a real Zustand vanilla store over the page's local-state document (a StatePort, the one
 * comment views read). Pure: no DOM, storage or timers; ./page-state supplies the port.
 *
 * Zustand's own `persist` middleware hydrates it from the port and hands every setState to the storage adapter below,
 * which writes it with the port's compare-and-swap. The adapter also feeds every port change (another tab, a comment-view
 * restore, a comment view) back into the store, which `persist` alone never does.
 *
 * getState, setState(partial | fn, replace) and subscribe behave as in Zustand (subscribe never fires on the current
 * value). Two differences follow from the document being one viewer's storable JSON:
 *  - setState throws a TypeError, changing nothing, for a value the document cannot store (assertStorable).
 *  - setState returns a promise that settles once the write landed (or was abandoned). If another tab changed the
 *    document first, the partial (or the function, on the new document) is applied again, at most MAX_ATTEMPTS times.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import { persist, type PersistStorage } from 'zustand/middleware';
import type { HtmlJsonObject } from '@artifactbin/contracts';
import type { StatePort, StoreWrite } from './apollo/apollo-contracts';
import { canonical, own, setOwn } from './apollo/local-store';
import { check } from './apollo/storable';

type Doc = HtmlJsonObject;
type Partial = Doc | ((state: Doc) => Doc);
/** What one setState asked for, and what it produced on the state it ran against (reused when that is still the document). */
interface Intent { partial: Partial; replace?: boolean; base: Doc; result: Doc }
const MAX_ATTEMPTS = 10;

/** The store `@afbin/state` exports as `state`: Zustand's StoreApi plus `persist`, its setState awaitable. */
export type PageStore = Omit<StoreApi<Doc>, 'setState'> & {
  setState(partial: Partial | globalThis.Partial<Doc>, replace?: false): Promise<void>;
  setState(state: Doc | ((state: Doc) => Doc), replace: true): Promise<void>;
  persist: { rehydrate(): Promise<void>; hasHydrated(): boolean; clearStorage(): void };
};

const same = (a: Doc, b: Doc) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && canonical(a[key]) === canonical(b[key]));
};
/** The document as the store's next state: unchanged fields keep their current values (selectors see no change), and an unchanged document is the current state itself. */
const reconcile = (current: Doc | undefined, document: Doc): Doc => {
  if (!current) return document;
  if (same(current, document)) return current;
  return Object.fromEntries(Object.entries(document).map(([key, value]) => [key, Object.hasOwn(current, key) && canonical(current[key]) === canonical(value) ? current[key]! : value]));
};
/** The next document, or a TypeError for one the document cannot hold. */
function produce(partial: Partial, replace: boolean | undefined, state: Doc): Doc {
  const next = typeof partial === 'function' ? partial(state) : partial;
  if (next === state) return state;
  if (next === null || typeof next !== 'object' || Array.isArray(next)) throw new TypeError('state.setState takes an object, or a function returning one');
  check(next, 'state', new Set());
  return replace ? next : { ...state, ...next };
}

export function createStateStore(port: StatePort, options: { initial?: Doc; name?: string; onError?: (error: unknown) => void } = {}): PageStore {
  const report = options.onError ?? ((error: unknown) => console.error(error));
  /** The commit of the setState now running (persist hands its setItem no intent). Nested calls keep their own. */
  let pending: Promise<void> | undefined;
  let queue: Promise<void> = Promise.resolve();
  /** This tab's writes still queued: until they land, a port change would show an intermediate document, so it waits. */
  let inflight = 0;
  let store: PageStore;
  const enqueue = (intent: Intent) => { inflight++; return (queue = queue.then(() => commit(intent)).finally(() => { if (!--inflight) void store.persist.rehydrate(); })); };
  /** Compare-and-swap against the newest document; on a conflict, apply the intent again to the document that won. */
  const commit = async (intent: Intent) => {
    let document = port.read();
    try {
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        const target = attempt === 0 && same(intent.base, document) ? intent.result : produce(intent.partial, intent.replace, document);
        const change: StoreWrite = { expected: { ...document }, next: {}, exact: true };
        for (const key of new Set([...Object.keys(document), ...Object.keys(target)]))
          if (canonical(own(document, key)) !== canonical(own(target, key))) setOwn(change.next, key, own(target, key));
        if (!Object.keys(change.next).length) break;
        const receipt = await port.write(change);
        if (receipt.status === 'committed') break;
        if (receipt.status === 'rejected') throw new TypeError(receipt.error);
        document = receipt.document;
        if (attempt === MAX_ATTEMPTS - 1) throw new Error(`state.setState conflicted ${MAX_ATTEMPTS} times; the change was not saved`);
      }
    } catch (error) {
      report(error);
    }
  };
  const storage: PersistStorage<Doc, Promise<void>> = {
    getItem: () => ({ state: port.read(), version: 0 }),
    setItem(_name, value) {
      // A setState through this store's own wrapper already queued its intent; anything else saves the whole state.
      if (pending) { const queued = pending; pending = undefined; return queued; }
      return enqueue({ partial: value.state, replace: true, base: port.read(), result: value.state });
    },
    removeItem() { const current = port.read(); return enqueue({ partial: {}, replace: true, base: current, result: {} }); },
  };
  const initial = options.initial ?? {};
  store = createStore<Doc>()(persist(() => initial, {
    name: options.name ?? 'af:viewer',
    storage,
    merge: (persisted, current) => reconcile(current, (persisted as Doc | undefined) ?? port.read()),
  })) as unknown as PageStore;
  // Queue each setState's intent in call order, then apply it. A subscriber that calls setState while this one notifies
  // runs inside `persisted`: it saves and restores `pending`, so the outer call still commits its own partial, never a
  // full replacement of the state it saw (which would undo another tab's concurrent change).
  const persisted = store.setState.bind(store) as (state: Doc, replace?: boolean) => Promise<void>;
  store.setState = ((partial: Partial, replace?: boolean) => {
    const base = store.getState();
    const result = produce(partial, replace, base);
    const committed = enqueue({ partial, replace, base, result });
    const previous = pending;
    pending = committed;
    try { void persisted(result, true); } finally { pending = previous; }
    return committed;
  }) as PageStore['setState'];
  // Every change to the document (another tab, a comment-view restore, a restored comment view, this store's own commits).
  port.subscribe(() => { if (!inflight) void store.persist.rehydrate(); });
  return store;
}

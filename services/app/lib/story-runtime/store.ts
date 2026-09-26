import type {ImageAssetAnswer} from '@/lib/story/ref-data';
/**
 * The document's DATA at runtime — one store per document, react-free.
 *
 * Seeded from the island's `dataflow` (declarations + the state the server
 * rendered with), it holds every scalar's current value and every table's
 * current rows, and it is the ONE thing every consumer reads: the runtime's
 * React tree (through `useSyncExternalStore`), the bound native controls
 * (`<select value="$region">` writes here), and the author's script through
 * `window.mx` (lib/story-runtime/mx.ts). Nothing else holds document data.
 *
 * Reactivity is by reference: the declarations become a dependency graph
 * (runtime-graph.ts) and a pure core (dataflow-core.ts) versions every node,
 * so setting a scalar makes exactly the queries that read it — transitively —
 * not current, and the TRANSPORT re-runs those with the current values. A
 * result lands for every query whose inputs have not moved since it was asked,
 * whichever run it came from. The store never knows how a query runs: the
 * served document GETs its own query url when it is the page and relays
 * through the parent when it has one (document-transport.ts); the edit canvas
 * fetches the owner path directly. Without a transport, values still change
 * (controls stay live) and tables stay as rendered.
 *
 * This file is the SHELL around that core: the transport, the debounce timer,
 * the listeners and the promises a caller awaits.
 *
 * `getState()` returns the SAME object until something changes — the identity
 * contract `useSyncExternalStore` needs, and what keeps a re-render from
 * cascading through every embed on every keystroke.
 */
import type { Dataflow, DataflowState, Row, Scalar, TableResult } from '@/lib/story/dataflow';
import type { LocalMutationResult } from '@/lib/story/local-state';
import {
  accessSettled, busyOf, createCore, localRows, pendingOf, step,
  type CoreEffect, type CoreEvent, type CoreState, type RunAnswer,
} from './dataflow-core';
import { graphOfDataflow } from './runtime-graph';

/** What `mutationUnavailable` answers while the permission check is still in flight. */
export const ACCESS_PENDING = 'Checking edit access…';

export interface MutationAnswer { dataset: string; local?: LocalMutationResult }

/** A window of one query's rows — what a table reads past the cap. */
interface TablePage {
  offset: number;
  limit: number;
  sort?: { col: string; dir: 'asc' | 'desc' };
}

/** What the store asks of the outside to re-run queries. */
export interface QueryTransport {
  /**
   * Run `only` (dependency-closed by the server) with these values; resolve
   * with the resulting tables + errors for those queries. A rejection is
   * reported as an error on every requested query — never thrown into UI.
   */
  run(values: Record<string, Scalar>, only: string[], localTables?: Record<string, Row[]>): Promise<RunAnswer>;
  /** Read a window of one query with these values; resolves with that query's rows for the window. */
  page(values: Record<string, Scalar>, name: string, page: TablePage, localTables?: Record<string, Row[]>): Promise<TableResult>;
  /**
   * Perform a declared `<Mutation>` with these values. Resolves with the
   * dataset that changed (so the store knows what to re-run), rejects with the
   * server's message. Absent on a transport that cannot write (the editor's
   * draft path, a capture) — the store then reports that plainly.
   */
  mutate?(values: Record<string, Scalar>, name: string, row?: Record<string, Scalar>, localTables?: Record<string, Row[]>): Promise<MutationAnswer>;
  /**
   * Import one web URL the document ended up with (a bound `<img src="$pick">`,
   * a column of logos) and resolve with the ADDRESS of our copy.
   *
   * Present only on the RELAY — a framed document, where the page holds the
   * session the endpoint needs. Top-level the `<img>` element is its own
   * transport: its src IS the endpoint and the browser follows the redirect,
   * so there is nothing here to do and this is deliberately absent.
   *
   * Like `mutate`, this is not a query; what it shares with one is the channel.
   * The document has ONE way to reach the outside, and this interface is it.
   */
  importAsset?(url: string, kind?: import('./managed-assets').ManagedAssetKind, signal?: AbortSignal): Promise<ImageAssetAnswer>;
}

export interface DataflowStore {
  readonly disposed: boolean;
  /** Revoke this document lifetime, including queued and in-flight completions. */
  dispose(): void;
  readonly flow: Dataflow;
  /** Current snapshot; identity-stable between changes. */
  getState(): DataflowState;
  getValue(name: string): Scalar;
  /**
   * Set a declared scalar (undeclared names are ignored); what reads it stops
   * being current. A discrete change (a select, a button, a script) runs at
   * once; a CONTINUOUS one (a slider, typing) passes `debounce` and waits for
   * the reader to pause.
   */
  setValue(name: string, value: Scalar, options?: { debounce?: boolean }): void;
  setValues(values: Record<string, Scalar>): void;
  getTable(name: string): TableResult | undefined;
  /**
   * Queries whose rows are NOT CURRENT, asked for or not (an embed shows
   * "loading" for these).
   *
   * Not only the ones in flight, and that is paint-first's doing: the server
   * renders a document with no rows and no transport, so nothing is ever in
   * flight and no embed is busy; the browser renders the same document a tick
   * later with its queries already asked for, and every embed IS busy. React
   * answers that with #418 by throwing the server's tree away. Both sides
   * agree on "not current" — and it is the more honest answer while a slider
   * is still moving: the chart beside it is stale.
   *
   * MEMOISED, and that is not an optimisation. This is a
   * `useSyncExternalStore` snapshot, which must be REFERENTIALLY STABLE
   * between changes; returning a fresh Set per call put every document with a
   * pending query into an infinite render loop that blocked its own event
   * loop — no timers, no promise callbacks, the author script never injected
   * and the query never resolving, on a page that otherwise looked fine.
   */
  pending(): ReadonlySet<string>;
  /** Run everything waiting, immediately — the first load, when its transport can answer. */
  start(): void;
  /**
   * Run a declared `<Mutation>` with the CURRENT values, then re-run every
   * query that reads the dataset it wrote — so the click that adds a row is
   * the click that redraws the chart, with no round trip through the live
   * stream. Resolves when the write has landed (the re-run follows on its own);
   * rejects with the server's message, which the caller may show.
   */
  mutate(name: string, overrides?: Record<string, Scalar>, row?: Record<string, Scalar>): Promise<void>;
  /** Mutations currently in flight (a bound <Button> shows itself busy). */
  mutating(): ReadonlySet<string>;
  /** Whether the attached document transport can perform writes. */
  canMutate(name?: string): boolean;
  mutationUnavailable(name: string): string | null;
  /**
   * Why this Value's controls must not move on this render
   * (CreateStoreOptions.frozenValues), or null when they work as usual.
   */
  frozenReason(name: string): string | null;
  /**
   * Resolves once every write check has landed — answered, or failed and
   * waiting for the next run (it then keeps whatever answer it had). A caller
   * that would otherwise refuse with ACCESS_PENDING waits for the real answer.
   */
  accessSettled(): Promise<void>;
  /**
   * A dataset changed elsewhere (the live stream's `data` frame): every query
   * that reads it — and everything downstream — and every write check on it
   * stops being current, and re-runs now.
   * Unknown ids are ignored, so a frame for a dataset this version no longer
   * reads costs nothing.
   */
  invalidateDatasets(datasetIds: Iterable<string>): void;
  subscribe(listener: () => void): () => void;
  /** Attach/replace the transport; runs whatever is not current immediately. */
  setTransport(transport: QueryTransport | null): void;
  /** Re-run the given queries (or every query) and the write checks now, current or not. */
  refresh(only?: Iterable<string>): void;
  /**
   * Fetch a window of one query's rows with the CURRENT values, through the
   * transport; resolves with the window (rejects without a transport). Does
   * not touch the store's tables — a table decides how to merge its pages.
   */
  fetchPage(name: string, page: TablePage): Promise<TableResult>;
  /**
   * Adopt a NEW VERSION OF THE DOCUMENT — the agent rewrote it while someone
   * was reading (lib/story-runtime/entry). The declarations and the server's
   * freshly computed state replace what is here, but the READER's choices are
   * not the document's to reset: a value whose name and type survive the
   * rewrite keeps whatever they set it to.
   *
   * The incoming tables were computed by the server from the DEFAULTS, so
   * wherever a retained choice disagrees with them the dependent queries are
   * not current and re-run through the transport — the same path a click on
   * the control takes. Their old rows stay on screen until the run lands.
   */
  replaceFlow(next: { flow: Dataflow; state?: DataflowState }): void;
}

interface CreateStoreOptions {
  /** Debounce before a CONTINUOUS change re-runs (default 150 ms) — a slider must not fire per pixel. */
  debounceMs?: number;
  transport?: QueryTransport | null;
  /**
   * ONE reason that refuses EVERY write on this render, whatever the datasets
   * would have said (StoryIslandData.readOnly): a SNAPSHOT render — today
   * `?version=N`, the archived view — is not the document a write could land
   * on, so it says so by name instead of letting the missing transport answer
   * "This view cannot save changes", which is true and about the wrong thing.
   *
   * It wins over the transport check and over per-mutation access, because it
   * is a fact about the RENDER rather than about the data.
   */
  writesUnavailable?: string | null;
  /**
   * Values whose bound controls render DISABLED on this render, each with the
   * reason shown in their place — an offline file cannot re-run a query for a
   * value nobody precomputed (lib/offline/file-format ArtifactFileSnapshot
   * `frozen`). A fact about the render, like `writesUnavailable`; absent (every
   * served document) no control is frozen.
   */
  frozenValues?: Readonly<Record<string, string>> | null;
}

/** Empty declarations + state, for a document that declares nothing. */
export const EMPTY_STATE: DataflowState = { values: {}, tables: {}, errors: {} };

export function createDataflowStore(
  /*
   * `values` is the THIRD island field — values WITHOUT rows.
   * The reader's URL carries their `<Value>` choices, and they must be the
   * store's starting point before its first run. Seeding them through `state`
   * cannot work: `state` present is how a capture and the editor's canvas say
   * "the rows are already computed", so it silently cancels paint-first's
   * first run. Precedence, lowest to highest: the declarations' own defaults,
   * the state a capture arrived with, then the URL — the reader's link is the
   * most specific thing anyone said about this document.
   */
  input: { flow: Dataflow; state?: DataflowState; values?: Record<string, Scalar> },
  options: CreateStoreOptions = {},
): DataflowStore {
  let flow = input.flow;
  const debounceMs = options.debounceMs ?? 150;
  let transport: QueryTransport | null = options.transport ?? null;
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  /*
   * A document that arrived WITHOUT its rows is the paint-first shape: the
   * server sent the declarations so the page could reach final geometry at
   * once, and the rows are this store's job — every query starts pending. The
   * rows still ride along for a capture and for the editor's canvas, and that
   * case re-runs nothing: `state` present means somebody already did this work
   * with the same defaults (dataflow-core createCore).
   */
  let core: CoreState = createCore(graphOfDataflow(flow), input);
  let writeIds = 0;
  const writes = new Map<number, { resolve: () => void; reject: (error: unknown) => void }>();
  let accessWaiters: Array<() => void> = [];
  const accessIsSettled = () => !transport || core.disposed || accessSettled(core);

  /*
   * ONE door for every change: the core decides, then its effects run. The
   * new state is in place BEFORE any effect runs, because a listener may call
   * straight back into the store (the URL sync, the author bridge).
   */
  const dispatch = (event: CoreEvent): boolean => {
    const before = core;
    const { state, effects } = step(core, event);
    core = state;
    for (const effect of effects) perform(effect);
    if (accessWaiters.length && accessIsSettled()) { const waiting = accessWaiters; accessWaiters = []; for (const w of waiting) w(); }
    return core !== before;
  };

  const perform = (effect: CoreEffect) => {
    switch (effect.type) {
      case 'notify': for (const l of [...listeners]) l(); return;
      case 'settle': {
        const settle = writes.get(effect.id);
        writes.delete(effect.id);
        if (effect.outcome.ok) settle?.resolve(); else settle?.reject(effect.outcome.error);
        return;
      }
      case 'run': {
        const t = transport;
        if (!t) { dispatch({ type: 'failed', at: effect.at, error: new Error('no query transport') }); return; }
        let answer: ReturnType<QueryTransport['run']>;
        try {
          answer = effect.localTables ? t.run(effect.values, effect.only, effect.localTables) : t.run(effect.values, effect.only);
        } catch (error) { answer = Promise.reject(error); }
        answer.then(
          (result) => { dispatch({ type: 'answered', at: effect.at, answer: result }); },
          (error: unknown) => { dispatch({ type: 'failed', at: effect.at, error }); },
        );
        return;
      }
      case 'write': {
        const { id, name, values, row, localTables } = effect;
        const t = transport;
        let answer: Promise<MutationAnswer>;
        try {
          if (!t?.mutate) throw new Error('this document cannot write from here');
          answer = localTables ? t.mutate(values, name, row, localTables) : row === undefined ? t.mutate(values, name) : t.mutate(values, name, row);
        } catch (error) { answer = Promise.reject(error); }
        // A settled write moves what it wrote (and what it reset): re-read at once.
        answer.then(
          (result) => { dispatch({ type: 'written', id, name, answer: result }); flush(); },
          (error: unknown) => { dispatch({ type: 'writeFailed', id, name, error }); flush(); },
        );
      }
    }
  };

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (transport) dispatch({ type: 'flush' });
  };
  /** Only a continuous input (a slider, typing) waits: it must not fire per pixel or per keystroke. */
  const schedule = () => {
    if (!transport) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const setValues = (values: Record<string, Scalar>, debounce = false) => {
    if (!dispatch({ type: 'set', values })) return;
    if (debounce) schedule(); else flush();
  };

  const mutationUnavailable = (name: string): string | null => {
    // A fact about the RENDER beats every fact about the data: a snapshot
    // refuses even a `local` write, which would otherwise mutate a document
    // the reader cannot save (see CreateStoreOptions.writesUnavailable).
    if (options.writesUnavailable) return options.writesUnavailable;
    if (!transport?.mutate) return 'This view cannot save changes.';
    const decl = core.graph.mutations.find((m) => m.name === name);
    if (decl && 'local' in decl.target) return null;
    const access = core.data.mutationAccess ?? {};
    return Object.hasOwn(access, name) ? access[name]! : ACCESS_PENDING;
  };

  const mutate: DataflowStore['mutate'] = async (name, overrides, row) => {
    if (!core.graph.mutations.some((m) => m.name === name)) throw new Error(`this document declares no <Mutation name="${name}">`);
    if (!transport?.mutate) throw new Error('this document cannot write from here');
    const unavailable = mutationUnavailable(name);
    if (unavailable !== null) throw new Error(unavailable);
    if (!row && busyOf(core).has(name)) return; // generic Button double click is one write; row cells dedupe locally
    const id = ++writeIds;
    const settled = new Promise<void>((resolve, reject) => { writes.set(id, { resolve, reject }); });
    dispatch({ type: 'write', id, name, ...(overrides ? { overrides } : {}), ...(row ? { row } : {}) });
    return settled;
  };

  return {
    get disposed() { return core.disposed; },
    dispose() {
      if (core.disposed) return;
      dispatch({ type: 'dispose' });
      if (timer) clearTimeout(timer);
      timer = null;
      transport = null;
      listeners.clear();
      const waiting = accessWaiters; accessWaiters = []; for (const w of waiting) w();
    },
    get flow() { return flow; },
    replaceFlow: (next) => {
      if (core.disposed) return;
      flow = next.flow;
      dispatch({ type: 'replace', graph: graphOfDataflow(next.flow), ...(next.state ? { state: next.state } : {}) });
      flush();
    },
    mutate,
    mutating: () => busyOf(core),
    canMutate: (name) => name ? mutationUnavailable(name) === null : !!transport?.mutate,
    mutationUnavailable,
    frozenReason: (name) => (options.frozenValues && Object.hasOwn(options.frozenValues, name) ? options.frozenValues[name] ?? null : null),
    accessSettled: () => new Promise((resolve) => { if (accessIsSettled()) resolve(); else accessWaiters.push(resolve); }),
    invalidateDatasets: (datasetIds) => {
      // Immediately, not on the debounce: this is news from outside, and the
      // reader is looking at rows that are now wrong.
      if (dispatch({ type: 'sources', ids: [...datasetIds] })) flush();
    },
    getState: () => core.data,
    getValue: (name) => core.data.values[name] ?? null,
    setValue: (name, value, opts) => setValues({ [name]: value }, opts?.debounce),
    setValues: (values) => setValues(values),
    getTable: (name) => core.data.tables[name],
    pending: () => pendingOf(core),
    /*
     * Run what is waiting, NOW — the first load, once its transport can
     * actually be answered.
     *
     * The caller owns that timing and the store cannot: a top-level document
     * fetches for itself and should start the moment it exists, while a framed
     * one relays through the page and must not post before the page is
     * listening. Firing in the constructor did exactly that, and the message
     * was simply lost — the document then waited out the relay's 20s timeout
     * with empty charts and an author script that never ran.
     *
     * Not the debounce: that exists to batch a reader changing their mind, and
     * a first load has nothing to batch.
     */
    start: () => { flush(); },
    subscribe: (listener) => { if (!core.disposed) listeners.add(listener); return () => { listeners.delete(listener); }; },
    setTransport: (t) => {
      if (core.disposed) return;
      transport = t;
      dispatch({ type: 'touch' }); // what a write may do changed
      flush();
    },
    refresh: (only) => {
      if (dispatch({ type: 'refresh', ...(only ? { queries: [...only] } : {}) })) flush();
    },
    fetchPage: (name, page) => {
      if (!transport) return Promise.reject(new Error('no query transport'));
      const rows = localRows(core);
      return rows ? transport.page({ ...core.data.values }, name, page, rows) : transport.page({ ...core.data.values }, name, page);
    },
  };
}

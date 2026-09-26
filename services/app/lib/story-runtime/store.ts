import type {ImageAssetAnswer} from '@/lib/story/ref-data';
/**
 * The document's DATA at runtime — one store per document, react-free.
 *
 * Seeded from the island's `dataflow` (the compiled declarations + the state the server
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
import type { DataflowState, Row, Scalar, TableResult } from '@/lib/story/dataflow';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import { mutationRequestFor, type MutationRequest } from '@/lib/story/mutation-request';
import type { LocalMutationResult } from '@/lib/story/local-state';
import { importRef, selectQueries, type ImportTables } from '@/lib/story/compiled-flow';
import { localZone } from '@/lib/story/builtins';
import { placeDataflow, type DataflowPlacement } from '@/lib/story/placement';
import {
  accessSettled, busyOf, createCore, localRows, partitionRun, pendingOf, step,
  type CoreEffect, type CoreEvent, type CoreState, type RunAnswer,
} from './dataflow-core';
import { graphOfCompiled, heldSource, NOW_SOURCE } from './runtime-graph';
import type { Optimistic, PageEngine } from './page-engine';

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
   * Every row of one import the document declares, by its name, for the
   * page's own engine (lib/story-runtime/page-engine); rejects when this door's
   * viewer may not hold it. Absent on a transport that cannot ask (the relay,
   * a capture): the page then runs nothing itself.
   */
  hold?(name: string): Promise<ImportTables[string]>;
  /**
   * Perform a declared `<Mutation>` (lib/story/mutation-request: its name, its
   * arguments, the row and value its control supplies). Resolves with the
   * dataset that changed (so the store knows what to re-run), rejects with the
   * server's message. Absent on a transport that cannot write (the editor's
   * draft path, a capture) — the store then reports that plainly.
   */
  mutate?(request: MutationRequest): Promise<MutationAnswer>;
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
  readonly flow: CompiledDataflow;
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
  /**
   * Set several scalars at once. `frame` coalesces the run: the values are set
   * now, and what reads them runs once, at the next frame — an author script
   * setting a value on every pointer move must not run a query per event.
   */
  setValues(values: Record<string, Scalar>, options?: { frame?: boolean }): void;
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
   * Run a declared `<Mutation>`: each argument from `overrides` (what the
   * control's `args=` resolved to; `_value` for an editing cell) or else the
   * CURRENT page value of the same name, with the row the control sits in.
   * Then re-run every query that reads the dataset it wrote — so the click
   * that adds a row is the click that redraws the chart, with no round trip
   * through the live stream. Resolves when the write has landed (the re-run
   * follows on its own); rejects with the server's message, which the caller
   * may show.
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
  /** Re-run the given queries (or every query) now, current or not. */
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
  replaceFlow(next: { flow: CompiledDataflow; state?: DataflowState; hold?: string[] }): void;
}

export interface CreateStoreOptions {
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
  /**
   * The page's own engine (lib/story-runtime/page-engine) and who is reading
   * (`$_me.id`). With it, every node the reader's holdings allow
   * (StoryIslandDataflow.hold, lib/story/placement) runs in the page once the
   * page holds what it reads, and only the rest goes through the transport.
   * Absent, everything goes through the transport, as it always has.
   */
  page?: { engine: PageEngine; userId: string | null } | null;
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
  input: { flow: CompiledDataflow; state?: DataflowState; values?: Record<string, Scalar>; hold?: string[] },
  options: CreateStoreOptions = {},
): DataflowStore {
  let flow = input.flow;
  const debounceMs = options.debounceMs ?? 150;
  let transport: QueryTransport | null = options.transport ?? null;
  const page = options.page ?? null;
  let hold = input.hold;
  let placement: DataflowPlacement = placeDataflow(flow, page ? hold : undefined);
  /** `$_now` as the page binds it: set at load, advanced once a minute (the clock below). */
  let now = new Date().toISOString();
  let clock: ReturnType<typeof setInterval> | null = null;
  /** Something can answer a run: the transport, or the page for what it holds. */
  const canRun = () => !!transport || !!page;
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
  let core: CoreState = createCore(graphOfCompiled(flow, placement), input);
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
        // ONE scheduling step, two places: what the page holds, the page
        // answers; the rest (and every write check) goes to the server.
        const { local, remote } = partitionRun(effect, inPage(effect.only));
        const answer = (at: typeof effect.at, run: () => Promise<RunAnswer>) => {
          let result: Promise<RunAnswer>;
          try { result = run(); } catch (error) { result = Promise.reject(error); }
          result.then(
            (answered) => { dispatch({ type: 'answered', at, answer: answered }); },
            (error: unknown) => { dispatch({ type: 'failed', at, error }); },
          );
        };
        if (local && page) answer(local.at, () => page.engine.run(flow, local.only, { ...context(), values: local.values, ...(local.localTables ? { localTables: local.localTables } : {}) }));
        if (remote) {
          const t = transport;
          if (!t) { dispatch({ type: 'failed', at: remote.at, error: new Error('no query transport') }); return; }
          answer(remote.at, () => remote.localTables ? t.run(remote.values, remote.only, remote.localTables) : t.run(remote.values, remote.only));
        }
        return;
      }
      case 'write': {
        const { id, name, values, row, localTables } = effect;
        let answer: Promise<MutationAnswer>;
        try {
          const m = flow.mutations.find((x) => x.name === name);
          if (!m) throw new Error(`this document declares no <Mutation name="${name}">`);
          const request = mutationRequestFor(m, { values, ...(row ? { row } : {}), ...(Object.hasOwn(values, '_value') ? { value: values._value } : {}), ...(localTables ? { localTables } : {}) });
          answer = writeThrough(m, request);
        } catch (error) { answer = Promise.reject(error); }
        // A settled write moves what it wrote (and what it reset): re-read at once.
        answer.then(
          (result) => { dispatch({ type: 'written', id, name, answer: result }); flush(); },
          (error: unknown) => { dispatch({ type: 'writeFailed', id, name, error }); flush(); },
        );
      }
    }
  };

  /** What the page reads beside a run's values: the viewer, the clock, the zone. */
  const context = () => ({ userId: page?.userId ?? null, now, tz: localZone() });

  /** The imports these queries read, with everything upstream of them. */
  const importsOf = (names: readonly string[]): string[] =>
    [...new Set(selectQueries(flow, { only: names }).flatMap((q) => q.reads.imports))];

  /**
   * The queries of this run the page answers: placed in the browser, and the
   * page holds everything they read. Otherwise the page starts fetching it,
   * and the server answers this run — the first paint never waits on the
   * engine.
   */
  const inPage = (only: readonly string[]): ReadonlySet<string> => {
    if (!page) return new Set();
    const mine = only.filter((name) => placement.queries[name] === 'browser');
    if (!mine.length) return new Set();
    const imports = importsOf(mine);
    if (page.engine.ready(flow, imports)) return new Set(mine);
    page.engine.prepare(flow, imports);
    return new Set();
  };

  /**
   * Where a write goes. A local-table write the page can compute never
   * leaves it. A held dataset write is applied to the page's copy at once —
   * what reads that copy re-runs in the page — and then the SERVER decides:
   * confirmed, the page fetches what was stored; refused, the page withdraws
   * it and the caller gets the server's reason.
   */
  const writeThrough = (m: CompiledDataflow['mutations'][number], request: MutationRequest): Promise<MutationAnswer> => {
    const where = placement.mutations[m.name];
    if (page && where === 'browser' && page.engine.ready(flow, m.reads.imports)) {
      return page.engine.write(flow, m, request, context()).then((local) => ({ dataset: '', local }));
    }
    const t = transport;
    if (!t?.mutate) throw new Error('this document cannot write from here');
    const ref = 'import' in m.target ? importRef(flow, m.target.import) : undefined;
    let optimistic: Optimistic | null = null;
    if (page && ref && where === 'optimistic' && 'import' in m.target && page.engine.ready(flow, [...m.reads.imports, m.target.import])) {
      optimistic = page.engine.apply(flow, m, request, context());
      if (optimistic && dispatch({ type: 'sources', ids: [heldSource(ref)] })) flush();
    }
    return t.mutate(request).then((answer) => {
      optimistic?.settle(true);
      // What the server stored is the page's copy now: fetch it before the page answers from it.
      page?.engine.invalidate([answer.dataset || ref || ''].filter(Boolean));
      return answer;
    }, (error: unknown) => { optimistic?.settle(false); throw error; });
  };

  let started = false;
  /**
   * Advance `$_now` once a minute while anything reads it — in a page that
   * runs queries itself, once it has started. Never on a server render (which
   * builds a store and never starts it) and never merely to poll the server.
   */
  const tickWhileRead = () => {
    const reads = !!page && started && !core.disposed && core.graph.queries.some((q) => q.reads.sources.includes(NOW_SOURCE));
    if (reads && !clock) {
      clock = setInterval(() => {
        now = new Date().toISOString();
        if (dispatch({ type: 'sources', ids: [NOW_SOURCE] })) flush();
      }, 60_000);
    } else if (!reads && clock) { clearInterval(clock); clock = null; }
  };

  /** Load the engine and every import the page will answer from — after the first run is on its way. */
  const prepare = () => {
    if (!page) return;
    const queries = flow.queries.filter((q) => placement.queries[q.name] === 'browser').map((q) => q.name);
    const writes = flow.mutations.filter((m) => placement.mutations[m.name] !== 'server');
    if (!queries.length && !writes.length) return;
    page.engine.prepare(flow, [...new Set([...importsOf(queries), ...writes.flatMap((m) => m.reads.imports)])]);
  };

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    frame?.();
    if (canRun()) dispatch({ type: 'flush' });
  };
  /** The pending frame's canceller: one flush per frame, whichever of the frame or its fallback comes first. */
  let frame: (() => void) | null = null;
  const nextFrame = () => {
    if (frame || !canRun()) return;
    // A hidden tab runs no animation frames; the timer keeps its writes moving.
    const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => flush()) : null;
    const fallback = setTimeout(flush, 100);
    frame = () => { frame = null; if (raf !== null) cancelAnimationFrame(raf); clearTimeout(fallback); };
  };
  /** Only a continuous input (a slider, typing) waits: it must not fire per pixel or per keystroke. */
  const schedule = () => {
    if (!canRun()) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  const setValues = (values: Record<string, Scalar>, when: 'now' | 'debounce' | 'frame' = 'now') => {
    if (!dispatch({ type: 'set', values })) return;
    if (when === 'debounce') schedule(); else if (when === 'frame') nextFrame(); else flush();
  };

  const mutationUnavailable = (name: string): string | null => {
    // A fact about the RENDER beats every fact about the data: a snapshot
    // refuses even a `local` write, which would otherwise mutate a document
    // the reader cannot save (see CreateStoreOptions.writesUnavailable).
    if (options.writesUnavailable) return options.writesUnavailable;
    const decl = core.graph.mutations.find((m) => m.name === name);
    const inPageWrite = !!page && placement.mutations[name] === 'browser';
    if (!transport?.mutate && !inPageWrite) return 'This view cannot save changes.';
    if (decl && 'local' in decl.target) return null;
    const access = core.data.mutationAccess ?? {};
    return Object.hasOwn(access, name) ? access[name]! : ACCESS_PENDING;
  };

  const mutate: DataflowStore['mutate'] = async (name, overrides, row) => {
    if (!core.graph.mutations.some((m) => m.name === name)) throw new Error(`this document declares no <Mutation name="${name}">`);
    if (!transport?.mutate && !(page && placement.mutations[name] === 'browser')) throw new Error('this document cannot write from here');
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
      if (clock) clearInterval(clock);
      timer = null;
      clock = null;
      frame?.();
      transport = null;
      listeners.clear();
      const waiting = accessWaiters; accessWaiters = []; for (const w of waiting) w();
    },
    get flow() { return flow; },
    replaceFlow: (next) => {
      if (core.disposed) return;
      flow = next.flow;
      hold = next.hold ?? hold;
      placement = placeDataflow(flow, page ? hold : undefined);
      dispatch({ type: 'replace', graph: graphOfCompiled(next.flow, placement), ...(next.state ? { state: next.state } : {}) });
      tickWhileRead();
      flush();
      prepare();
    },
    mutate,
    mutating: () => busyOf(core),
    canMutate: (name) => name ? mutationUnavailable(name) === null : !!transport?.mutate,
    mutationUnavailable,
    frozenReason: (name) => (options.frozenValues && Object.hasOwn(options.frozenValues, name) ? options.frozenValues[name] ?? null : null),
    accessSettled: () => new Promise((resolve) => { if (accessIsSettled()) resolve(); else accessWaiters.push(resolve); }),
    invalidateDatasets: (datasetIds) => {
      // Immediately, not on the debounce: this is news from outside, and the
      // reader is looking at rows that are now wrong. The page's copy is too:
      // until it is fetched again, its readers ask the server.
      const ids = [...datasetIds];
      page?.engine.invalidate(ids);
      if (dispatch({ type: 'sources', ids })) flush();
    },
    getState: () => core.data,
    getValue: (name) => core.data.values[name] ?? null,
    setValue: (name, value, opts) => setValues({ [name]: value }, opts?.debounce ? 'debounce' : 'now'),
    setValues: (values, opts) => setValues(values, opts?.frame ? 'frame' : 'now'),
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
    start: () => { started = true; flush(); prepare(); tickWhileRead(); },
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
    fetchPage: (name, window) => {
      const rows = localRows(core);
      if (page && inPage([name]).has(name)) {
        return page.engine.page(flow, name, window, { ...context(), values: { ...core.data.values }, ...(rows ? { localTables: rows } : {}) });
      }
      if (!transport) return Promise.reject(new Error('no query transport'));
      return rows ? transport.page({ ...core.data.values }, name, window, rows) : transport.page({ ...core.data.values }, name, window);
    },
  };
}

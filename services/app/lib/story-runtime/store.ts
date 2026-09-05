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
 * Reactivity is by reference (lib/story/dataflow.ts): setting a scalar marks
 * the queries that bind it — transitively — dirty, and after a short debounce
 * the TRANSPORT re-runs exactly those with the current values and the results
 * merge back. The store never knows how a query runs: the served document
 * GETs its own query url when it is the page and relays through the parent
 * when it has one (document-transport.ts); the edit canvas fetches the owner
 * path directly. Without a transport, values still
 * change (controls stay live) and tables stay as rendered.
 *
 * `getState()` returns the SAME object until something changes — the identity
 * contract `useSyncExternalStore` needs, and what keeps a re-render from
 * cascading through every embed on every keystroke.
 */
import {
  initialTables, initialValues, mutationsOf, queriesDependingOn, queriesReadingDatasets,
  type Dataflow, type DataflowState, type Scalar, type TableResult,
} from '@/lib/story/dataflow';

/** A window of one query's rows — what a table reads past the cap. */
export interface TablePage {
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
  run(values: Record<string, Scalar>, only: string[]): Promise<Pick<DataflowState, 'tables' | 'errors'>>;
  /** Read a window of one query with these values; resolves with that query's rows for the window. */
  page(values: Record<string, Scalar>, name: string, page: TablePage): Promise<TableResult>;
  /**
   * Perform a declared `<Mutation>` with these values. Resolves with the
   * dataset that changed (so the store knows what to re-run), rejects with the
   * server's message. Absent on a transport that cannot write (the editor's
   * draft path, a capture) — the store then reports that plainly.
   */
  mutate?(values: Record<string, Scalar>, name: string, row?: Record<string, Scalar>): Promise<{ dataset: string }>;
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
  importAsset?(url: string): Promise<{ url: string } | { refused: string }>;
}

export interface DataflowStore {
  readonly flow: Dataflow;
  /** Current snapshot; identity-stable between changes. */
  getState(): DataflowState;
  getValue(name: string): Scalar;
  /** Set a declared scalar (undeclared names are ignored); marks dependents dirty. */
  setValue(name: string, value: Scalar): void;
  setValues(values: Record<string, Scalar>): void;
  getTable(name: string): TableResult | undefined;
  /** Query names currently being re-run (an embed shows "loading" for these). */
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
  /**
   * A dataset changed elsewhere (the live stream's `data` frame): mark every
   * query that reads it — and everything downstream — dirty, and re-run.
   * Unknown ids are ignored, so a frame for a dataset this version no longer
   * reads costs nothing.
   */
  invalidateDatasets(datasetIds: Iterable<string>): void;
  subscribe(listener: () => void): () => void;
  /** Attach/replace the transport; flushes any dirty queries immediately. */
  setTransport(transport: QueryTransport | null): void;
  /** Re-run the given queries (or every query) now, regardless of dirtiness. */
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
   * marked dirty and re-run through the transport — the same path a click on
   * the control takes. Their old rows stay on screen until the run lands.
   */
  replaceFlow(next: { flow: Dataflow; state?: DataflowState }): void;
}

export interface CreateStoreOptions {
  /** Debounce before a re-run (default 150 ms) — a slider must not fire per pixel. */
  debounceMs?: number;
  transport?: QueryTransport | null;
}

/** Empty declarations + state, for a document that declares nothing. */
export const EMPTY_STATE: DataflowState = { values: {}, tables: {}, errors: {} };

export function createDataflowStore(
  /*
   * SPIKE S1 (F2): `values` is the THIRD island field — values WITHOUT rows.
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
  let state: DataflowState = {
    values: { ...initialValues(flow), ...(input.state?.values ?? {}), ...(input.values ?? {}) },
    // Inline tables come from the declarations themselves — nobody has to run
    // anything for them, which is what makes a document of static rows work
    // with no server round trip at all.
    tables: { ...initialTables(flow), ...(input.state?.tables ?? {}) },
    errors: { ...(input.state?.errors ?? {}) },
  };
  const dirty = new Set<string>();
  const inFlight = new Set<string>();
  const writing = new Set<string>();
  const writingCounts = new Map<string, number>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  // A run started before a later change must not overwrite it: results are
  // applied only if they belong to the newest run.
  let runSeq = 0;

  /*
   * Queries whose rows are NOT CURRENT — dirty as well as in flight.
   *
   * It was in-flight alone, and paint-first made that a hydration mismatch:
   * the server renders a document with no rows and no transport, so nothing
   * ever leaves `dirty` and no embed is busy; the browser renders the same
   * document a tick later with its queries already in flight, and every embed
   * IS busy. React answers that with #418 by throwing the server's tree away.
   * Both sides agree on "not current", so that is what this reports — and it
   * is the more honest answer for the debounce window too: the moment a reader
   * moves a slider, the chart beside it is stale.
   *
   * MEMOISED, and that is not an optimisation. This is a
   * `useSyncExternalStore` snapshot, which must be REFERENTIALLY STABLE
   * between changes; returning a fresh Set per call put every document with a
   * pending query into an infinite render loop that blocked its own event
   * loop — no timers, no promise callbacks, the author script never injected
   * and the query never resolving, on a page that otherwise looked fine.
   */
  let pendingCache: ReadonlySet<string> | null = null;
  const pendingChanged = () => { pendingCache = null; };
  const pendingSet = (): ReadonlySet<string> => {
    if (!pendingCache) pendingCache = dirty.size === 0 ? new Set(inFlight) : new Set([...inFlight, ...dirty]);
    return pendingCache;
  };

  const notify = () => { for (const l of [...listeners]) l(); };
  const commit = (next: DataflowState) => { state = next; notify(); };

  const flush = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (!transport || dirty.size === 0) return;
    const only = [...dirty];
    dirty.clear();
    pendingChanged();
    const seq = ++runSeq;
    for (const n of only) inFlight.add(n);
    pendingChanged();
    // A NEW snapshot identity: `pending()` changed, and a subscriber that
    // compares snapshots (useSyncExternalStore) must see that as a change.
    commit({ ...state });
    const values = { ...state.values };
    transport.run(values, only).then(
      (result) => {
        if (seq !== runSeq) return; // superseded — the newer run will report
        for (const n of only) inFlight.delete(n);
        pendingChanged();
        const tables = { ...state.tables };
        const errors = { ...state.errors };
        for (const n of only) { delete tables[n]; delete errors[n]; }
        Object.assign(tables, result.tables);
        Object.assign(errors, result.errors);
        commit({ ...state, tables, errors });
      },
      (e: unknown) => {
        if (seq !== runSeq) return;
        for (const n of only) inFlight.delete(n);
        pendingChanged();
        const errors = { ...state.errors };
        const message = e instanceof Error ? e.message : String(e);
        for (const n of only) errors[n] = message;
        commit({ ...state, errors });
      },
    );
  };
  const schedule = () => {
    if (!transport || dirty.size === 0) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  /*
   * A document that arrived WITHOUT its rows is the paint-first shape: the
   * server sent the declarations so the page could reach final geometry at
   * once, and the rows are this store's job. Same rule replaceFlow already
   * follows for a stateless payload — everything declared is dirty — because
   * the alternative is a document that paints its skeletons and keeps them.
   *
   * The rows still ride along for a capture and for the editor's canvas, and
   * that case must re-run nothing: `state` present means somebody already did
   * this work with the same defaults.
   */
  if (!input.state) { for (const q of flow.queries) dirty.add(q.name); pendingChanged(); }

  let scalarNames = new Set(flow.values.filter((v) => v.kind === 'scalar').map((v) => v.name));
  /** The declared type of each scalar — what a retained reader value is checked against. */
  const scalarTypes = () => new Map(
    flow.values.filter((v) => v.kind === 'scalar').map((v) => [v.name, (v as { type?: string }).type ?? null]),
  );

  const setValues = (values: Record<string, Scalar>) => {
    const changed: string[] = [];
    for (const [k, v] of Object.entries(values)) {
      if (!scalarNames.has(k)) continue;
      if (Object.is(state.values[k], v)) continue;
      changed.push(k);
    }
    if (!changed.length) return;
    const nextValues = { ...state.values };
    for (const k of changed) nextValues[k] = values[k];
    for (const q of queriesDependingOn(flow, changed)) dirty.add(q);
    pendingChanged();
    commit({ ...state, values: nextValues });
    schedule();
  };

  const replaceFlow: DataflowStore['replaceFlow'] = (next) => {
    const before = scalarTypes();
    const kept: Record<string, Scalar> = {};
    const previousValues = state.values;
    flow = next.flow;
    scalarNames = new Set(flow.values.filter((v) => v.kind === 'scalar').map((v) => v.name));
    const after = scalarTypes();
    for (const name of scalarNames) {
      // A name that survived AND kept its type is the same control: the reader's
      // choice belongs to them, not to the version of the document they had.
      if (!(name in previousValues)) continue;
      if (before.get(name) !== after.get(name)) continue;
      kept[name] = previousValues[name];
    }

    const incoming = { ...initialValues(flow), ...(next.state?.values ?? {}) };
    const values = { ...incoming, ...kept };
    // Anything in flight belongs to the document that is being replaced.
    runSeq++;
    inFlight.clear();
    dirty.clear();
    pendingChanged();
    // A payload that carries no state is a document whose queries have not been
    // run for us. Keep the rows already on screen (blanking every chart to
    // announce an edit elsewhere is the flicker this whole change is about) and
    // re-run them — but only for queries this version still declares.
    const declared = new Set(flow.queries.map((q) => q.name));
    const keepRows = <T,>(from: Record<string, T>): Record<string, T> =>
      Object.fromEntries(Object.entries(from).filter(([n]) => declared.has(n)));
    // The new version's own inline tables are a fact about it, and win: an
    // edit that changed those rows is exactly what the reader should now see.
    state = next.state
      ? { values, tables: { ...initialTables(flow), ...keepRows(next.state.tables ?? {}) }, errors: keepRows(next.state.errors ?? {}) }
      : { values, tables: { ...keepRows(state.tables), ...initialTables(flow) }, errors: keepRows(state.errors) };
    // The server ran these queries with the DEFAULTS. Where the reader's own
    // value disagrees, its dependents describe a document nobody is looking at.
    if (next.state) {
      const diverged = Object.keys(kept).filter((n) => !Object.is(kept[n], incoming[n]));
      for (const q of queriesDependingOn(flow, diverged)) dirty.add(q);
      pendingChanged();
    } else {
      for (const q of flow.queries) dirty.add(q.name);
      pendingChanged();
    }
    notify();
    schedule();
  };

  /** Queries that read these datasets (and their dependents) go dirty. */
  const invalidateDatasets: DataflowStore['invalidateDatasets'] = (datasetIds) => {
    const affected = queriesReadingDatasets(flow, datasetIds);
    if (!affected.length) return;
    for (const q of affected) dirty.add(q);
    pendingChanged();
    // Immediately, not on the debounce: this is news from outside, and the
    // reader is looking at rows that are now wrong.
    flush();
  };

  const mutate: DataflowStore['mutate'] = async (name, overrides, row) => {
    const decl = mutationsOf(flow).find((m) => m.name === name);
    if (!decl) throw new Error(`this document declares no <Mutation name="${name}">`);
    if (!transport?.mutate) throw new Error('this document cannot write from here');
    if (!row && writing.has(name)) return; // generic Button double click is one write; row cells dedupe locally
    writingCounts.set(name, (writingCounts.get(name) ?? 0) + 1);
    writing.add(name);
    commit({ ...state }); // `mutating()` changed — a bound Button shows itself busy
    try {
      const { dataset } = await transport.mutate({ ...state.values, ...overrides }, name, row);
      // The click that writes is the click that redraws: the reader must not
      // wait for the live stream to tell this document about its own write.
      invalidateDatasets([dataset || decl.target]);
    } finally {
      const left = (writingCounts.get(name) ?? 1) - 1;
      if (left > 0) writingCounts.set(name, left); else { writingCounts.delete(name); writing.delete(name); }
      commit({ ...state });
    }
  };

  return {
    get flow() { return flow; },
    replaceFlow,
    mutate,
    mutating: () => writing,
    invalidateDatasets,
    getState: () => state,
    getValue: (name) => state.values[name] ?? null,
    setValue: (name, value) => setValues({ [name]: value }),
    setValues,
    getTable: (name) => state.tables[name],
    pending: pendingSet,
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
    subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setTransport: (t) => { transport = t; flush(); },
    refresh: (only) => {
      const names = only ? [...only] : flow.queries.map((q) => q.name);
      for (const n of names) dirty.add(n);
      pendingChanged();
      flush();
    },
    fetchPage: (name, page) => {
      if (!transport) return Promise.reject(new Error('no query transport'));
      return transport.page({ ...state.values }, name, page);
    },
  };
}

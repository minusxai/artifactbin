/* @jsxImportSource solid-js */
/**
 * THE ISLAND RUNTIME (`@mx/rt`, docs/phase2-architecture.md §2.3, §4.1): what every compiled island
 * of one document runs on. Generated islands also import kit helpers when their markup needs them.
 *
 * - The document's data is the EXISTING react-free store (lib/story-runtime/store), bridged into
 *   one Solid store per document with `reconcile`, so a result that changes one cell re-runs only
 *   the computations that read that cell. Islands read it through `IslandContext` (contract.ts),
 *   provided to every island by `hydrateIsland`; the bridge is this file's detail.
 * - Reactive markup (`$x`, `$_row.f`, conditionals) is DATA: the compiler emits the parser's
 *   `ReactiveExpression` objects as JSON literals and they are evaluated here with the
 *   interpreter's own evaluator (lib/jsx/reactive). No author string ever becomes code.
 * - `hydrateIsland` adopts one server-rendered island in place: its root is found by its
 *   hydration-key prefix and every other child of its parent is handed back as the SAME node, so
 *   static siblings are never touched.
 *
 * Import-safe on the server (no DOM access at module scope): the SSR module renders the same
 * islands through `createIslandRuntime` + `withIsland`, with a store that has no transport.
 */
import { batch, createComponent, createMemo, createRoot, createSignal, For, Show } from 'solid-js';
import type { Component, JSX } from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';
import { hydrate, insert as solidInsert, isServer } from 'solid-js/web';
import type { ReactiveExpression } from '@/lib/jsx/reactive';
import { evaluateReactive } from '@/lib/jsx/reactive-eval';
import { substituteRow } from '@/lib/story/row-scope';
import { keyedRowsError } from '@/lib/story/row-key';
import type { CompiledDataflow } from '@/lib/story/compiled-dataflow';
import type { DataflowState, Row, Scalar, TableResult } from '@/lib/story/dataflow';
import { ACCESS_PENDING, type DataflowStore } from '@/lib/story-runtime/store';
import type { ServedResults, StoredMermaidImage } from '@/lib/story-runtime/contract';
import type { PersonCard } from '@artifactbin/contracts';
import { IslandProvider, useIsland } from './context';
import type { IslandChartModule, IslandContext, IslandViewer, WriteStatusFeed } from './contract';
import { trustedPortalOf } from './trusted-portal';

/*
 * THE GENERATED-CODE SURFACE. Islands are compiled with `moduleName: '@mx/rt'`, so every DOM
 * helper Solid's JSX transform (babel-plugin-jsx-dom-expressions, `generate: 'dom'`, hydratable)
 * can emit is re-exported from here, and nothing else of `solid-js/web`: the shared build's
 * statement-level splitting then keeps a page's closure to what islands actually use. The SSR
 * build (`generate: 'ssr'`) keeps importing `solid-js/web` on the server.
 */
export {
  addEventListener, className, classList, createComponent, delegateEvents, effect, getNextElement,
  getNextMarker, getNextMatch, getOwner, insert, memo, mergeProps, NoHydration, runHydrationEvents,
  setAttribute, setAttributeNS, setBoolAttribute, setProperty, setStyleProperty, spread, style,
  template, use,
} from 'solid-js/web';
/** For the SSR module's `render(data)`, which builds the same runtime without a transport. */
export { IslandProvider } from './context';
export { createDataflowStore } from '@/lib/story-runtime/store';

/* ────────────────────────────────────────────────────────────────────────────
 * The store bridge
 * ──────────────────────────────────────────────────────────────────────────── */

/** `createDataflowStore`'s input: the compiled declarations plus what the page starts from. */
export interface IslandDataflowInput {
  flow: CompiledDataflow;
  state?: DataflowState;
  values?: Record<string, Scalar>;
  hold?: string[];
  results?: ServedResults;
}

/** What one document's runtime starts from. */
export interface IslandRuntimeData {
  assetsUrl?: string;
  /** The store's input; absent or null for a document that declares no data (tabs, a diagram). */
  dataflow?: IslandDataflowInput | null;
  /** The version's stored Mermaid drawings (lib/mermaid-images). */
  mermaidImages?: Readonly<Record<string, StoredMermaidImage>>;
  /** Who reads: null for a guest, `{ hinted: true }` on a signed-in page until the overlay lands. */
  viewer?: IslandViewer;
  /** An archived render's refusal of every write (IslandPageData.readOnly). */
  readOnly?: string | null;
}

export interface IslandRuntimeOptions {
  /**
   * The write status feed over the runtime's store (lib/islands/writes `createWriteStatusFeed`),
   * injected so this module never imports the writes seam; absent: the empty feed.
   */
  writes?: (store: DataflowStore | null) => WriteStatusFeed;
  /** The lazy chart module (lib/islands/chart `loadChart`), injected by boot; absent (the SSR render): charts stay as drawn. */
  loadChart?: () => Promise<IslandChartModule>;
  /** Where overlays portal; absent: the page's trusted UI container, looked up when asked (trusted-portal.ts). */
  trustedPortal?: () => HTMLElement | null;
}

/** One document's runtime: the context every island receives, and the handles only the page holds. */
export interface IslandRuntime {
  context: IslandContext;
  store: DataflowStore | null;
  /**
   * THE VIEWER SEAM (w3-viewer-writes' overlay): `{ hinted: true }` → the identity, or → null when
   * the overlay says guest. Every island reading `viewer()` or `$_me.id` follows.
   */
  setViewer(viewer: IslandViewer): void;
  /** Stop following the store and dispose it. Islands are disposed by their own handles. */
  dispose(): void;
}

export const EMPTY_WRITE_FEED: WriteStatusFeed = Object.freeze({ current: () => [], subscribe: () => () => {}, dismiss: () => {} });

interface Bridged {
  values: Record<string, Scalar>;
  tables: Record<string, TableResult>;
  errors: Record<string, string>;
  pending: Record<string, true>;
  people: Record<string, PersonCard>;
}

/**
 * Start one document's runtime over `createStore` (the existing `createDataflowStore`, passed in
 * so the browser brings its transport and the server renders without one). Synchronous: the
 * Solid store holds the data store's snapshot before this returns.
 */
export function createIslandRuntime(
  data: IslandRuntimeData,
  createStore_: (input: IslandDataflowInput) => DataflowStore,
  options: IslandRuntimeOptions = {},
): IslandRuntime {
  const store = data.dataflow ? createStore_(data.dataflow) : null;
  const [state, setState] = createStore<Bridged>({ values: {}, tables: {}, errors: {}, pending: {}, people: {} });
  /** A counter per table, bumped when the data store REPLACES that table's result (a run landed). */
  const [versions, setVersions] = createStore<Record<string, number>>({});
  const [viewer, setViewer] = createSignal<IslandViewer>(data.viewer ?? null);
  /** Every store change: what the write checks (`mutationUnavailable`, `mutating`) re-read on. */
  const [checks, touch] = createSignal(undefined, { equals: false });
  const drawings = data.mermaidImages ?? {};
  let lastTables: Record<string, TableResult> = {};

  const sync = () => {
    if (!store) return;
    const snap = store.getState();
    const pending: Record<string, true> = {};
    for (const name of store.pending()) pending[name] = true;
    batch(() => {
      for (const [name, table] of Object.entries(snap.tables)) if (lastTables[name] !== table) setVersions(name, (v) => (v ?? 0) + 1);
      lastTables = snap.tables;
      setState('values', reconcile(snap.values));
      setState('tables', reconcile(snap.tables, { merge: true }));
      setState('errors', reconcile(snap.errors));
      setState('pending', reconcile(pending));
      setState('people', reconcile(snap.people ?? {}));
      touch();
    });
  };
  sync();
  const unsubscribe = store?.subscribe(sync) ?? (() => {});

  const noData = () => new Error('no data declared');
  const context: IslandContext = {
    assetsUrl: () => data.assetsUrl ?? null,
    values: () => state.values,
    value: (name) => state.values[name],
    table: (name) => state.tables[name],
    tableSnapshot: (name) => {
      void versions[name];
      return store?.getTable(name) ?? state.tables[name];
    },
    pending: (name) => !!state.pending[name],
    error: (name) => state.errors[name],
    people: () => state.people,
    setValue: (name, value, opts) => store?.setValue(name, value, opts?.debounce ? { debounce: true } : undefined),
    /*
     * The write as the wire states it (the store's `mutate(request)`): OPTIMISTIC — a click before
     * the write check has answered is sent and the server decides; a refusal lands in the status
     * feed with its reason and a retry. The answer names the dataset the declaration writes.
     */
    mutate: async (request) => {
      if (!store) throw noData();
      await store.mutate(request);
      const target = store.flow.mutations.find((m) => m.name === request.mutation)?.target;
      const ref = target && 'import' in target ? store.flow.imports.find((i) => i.name === target.import)?.ref : undefined;
      return { dataset: ref ?? '' };
    },
    writesUnavailable: () => data.readOnly ?? null,
    // The server renders without a transport: it says what today's served page says until the check answers.
    mutationUnavailable: (name) => { checks(); return store && !isServer ? store.mutationUnavailable(name) : ACCESS_PENDING; },
    mutating: (name) => { checks(); return !!store?.mutating().has(name); },
    viewer,
    drawings: () => drawings,
    writes: (options.writes ?? (() => EMPTY_WRITE_FEED))(store),
    store: () => store,
    trustedPortal: options.trustedPortal ?? (() => trustedPortalOf()),
    loadChart: options.loadChart ?? (() => Promise.reject(new Error('browser chart only'))),
  };

  return {
    context,
    store,
    setViewer: (next) => { setViewer(() => next); },
    dispose: () => { unsubscribe(); store?.dispose(); },
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Reactive markup, as data
 * ──────────────────────────────────────────────────────────────────────────── */

/** The row an element sits in and how its instance is named (`Repeat` passes it to its template). */
export interface RowScope {
  /** The repeat's own node id (`data-mx-ast` path or author id). */
  owner: string;
  /** The row's key (`keyBy`) or its index. */
  key: unknown;
  /** Whether `key` is a durable row key rather than a position. */
  durable: boolean;
  /** The template's author ids: an idref naming one is rewritten to that row's instance. */
  ids: readonly string[];
}

const viewerId = (v: IslandViewer): string | null => (v && 'id' in v ? v.id : null);

/** What a reactive expression reads: every value, plus the viewer built-in `_me.id`. Tracked per name. */
const signalsOf = (() => {
  const cache = new WeakMap<IslandContext, Record<string, unknown>>();
  return (island: IslandContext): Record<string, unknown> => {
    let signals = cache.get(island);
    if (!signals) {
      const read = (name: string) => (name === '_me.id' ? viewerId(island.viewer()) : island.values()[name]);
      const has = (name: string) => name === '_me.id' || Object.hasOwn(island.values(), name);
      signals = new Proxy({}, {
        get: (_t, name) => (typeof name === 'string' ? read(name) : undefined),
        has: (_t, name) => typeof name === 'string' && has(name),
        getOwnPropertyDescriptor: (_t, name) => (typeof name === 'string' && has(name) ? { enumerable: true, configurable: true, value: read(name) } : undefined),
        ownKeys: () => [...Object.keys(island.values()), '_me.id'],
      });
      cache.set(island, signals);
    }
    return signals;
  };
})();

/**
 * Evaluate a compiled `ReactiveExpression` against the island's values (and `row`). The context is
 * the one an enclosing `IslandProvider` supplies — inside a component or a render effect; an event
 * handler has no owner and passes `island` itself.
 */
export const expr = (e: ReactiveExpression, row?: Record<string, unknown>, island: IslandContext = useIsland()) => evaluateReactive(e, signalsOf(island), row);
/** A reactive child as the interpreter prints it: strings and numbers only. */
export const text = (e: ReactiveExpression, row?: Record<string, unknown>, island?: IslandContext): string | number | null => {
  const v = expr(e, row, island ?? useIsland());
  return typeof v === 'string' || typeof v === 'number' ? v : null;
};
/** A static value with `$_row.f` references filled from `row` (lib/story/row-scope). */
export const sub = <T,>(value: T, row: Record<string, unknown>): T => substituteRow(value, row);

export interface RepeatProps {
  /** The table (or table value) whose rows repeat. */
  name: string;
  keyBy?: string;
  owner?: string;
  ids?: readonly string[];
  /** Inside a table: no wrapper element (rows are the table's own parts). */
  tableParts?: boolean;
  /** Inside an SVG: the wrapper is a `<g>`. */
  svg?: boolean;
  children: (row: Row, scope: RowScope) => JSX.Element;
  /** The wrapper's own attributes (compile-time literals). */
  [attr: string]: unknown;
}

const REPEAT_PROPS = new Set(['name', 'keyBy', 'owner', 'ids', 'tableParts', 'svg', 'children']);

/**
 * `<For each={$name} keyBy="k">` — the interpreter's repeat: a wrapper element (a `<div>`, a `<g>`
 * in SVG, none among table parts) around one instance of the template per row. Rows come from the
 * bridged store, so a changed result re-renders only the rows that changed.
 */
export function Repeat(props: RepeatProps): JSX.Element {
  const island = useIsland();
  const rows = createMemo((): Row[] => {
    const source: unknown = island.table(props.name)?.rows ?? island.values()[props.name] ?? [];
    return Array.isArray(source) ? (source as Row[]) : [];
  });
  const error = createMemo(() => props.keyBy ? keyedRowsError(rows(), props.keyBy, 'keyBy') : null);
  const body = () => (
    error() ? (props.svg ? <text role="alert">{error()}</text> : <span role="alert">{error()}</span>)
      : <For each={rows()}>{(row, index) => props.children(row, { owner: props.owner ?? '', key: props.keyBy ? row[props.keyBy] : index(), durable: !!props.keyBy, ids: props.ids ?? [] })}</For>
  );
  if (props.tableParts) return body();
  const attrs = Object.fromEntries(Object.entries(props).filter(([k]) => !REPEAT_PROPS.has(k)));
  return props.svg ? <g {...attrs}>{body()}</g> : <div {...attrs}>{body()}</div>;
}

/** `{cond && …}` / `{cond ? a : b}` — the interpreter's conditional; a falsy value (0 included) renders nothing. */
export function When(props: { test: ReactiveExpression; row?: Record<string, unknown>; fallback?: JSX.Element; children?: JSX.Element }): JSX.Element {
  const island = useIsland();
  return <Show when={!!expr(props.test, props.row, island)} fallback={props.fallback}>{props.children}</Show>;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Hydration
 * ──────────────────────────────────────────────────────────────────────────── */

/** `Component` under the document's context: what an island is, on the server and in the browser. */
export const withIsland = (Component: Component, context: IslandContext): JSX.Element =>
  createComponent(IslandProvider, { value: context, get children() { return createComponent(Component, {}); } });

/** A compiler-generated hydration key prefix (`s<i>-`); anything else never reaches a selector. */
const RENDER_ID = /^[\w-]+$/;

/**
 * Hydrate one island in place. Its root is the first element under `parent` whose hydration key
 * starts with `renderId`; the root's parent's other children are handed back to Solid as
 * themselves, so static siblings stay the same nodes. Returns the island's disposer — which
 * unmounts its computations and leaves its DOM as static markup (never Solid's `render` disposer,
 * which empties the parent) — or null when the page has no such island.
 *
 * A root the served markup does not match (a hydration miss, or a non-hydratable build) comes back
 * as a fresh node; it replaces the served root, still leaving the siblings alone.
 */
export function hydrateIsland(renderId: string, Component: Component, context: IslandContext, parent: ParentNode = document): (() => void) | null {
  if (isServer || !RENDER_ID.test(renderId)) return null;
  const root = parent.querySelector(`[data-hk^="${renderId}"]`);
  const host = root?.parentNode as (Element & ParentNode) | null | undefined;
  if (!root || !host) return null;
  const g = globalThis as { _$HY?: { events: unknown[]; completed: WeakSet<object>; r: Record<string, unknown> } };
  g._$HY ??= { events: [], completed: new WeakSet(), r: {} };
  let disposeIsland: () => void = () => {};
  let output: unknown;
  let live: unknown;
  const mount = (dispose: () => void) => {
    disposeIsland = dispose;
    output = live = withIsland(Component, context);
    while (typeof output === 'function') output = (output as () => unknown)();
  };
  try {
    hydrate(() => createRoot((dispose) => {
      mount(dispose);
      // An island may render siblings of its root (a button and its refusal): those are the island's own
      // (their key has its prefix), never handed back as static siblings, and its output stays LIVE (the
      // accessor, not a snapshot of it) so a sibling that comes and goes is inserted and removed.
      const children = [...host.childNodes].filter((node) => node === root || !(node as Element).getAttribute?.('data-hk')?.startsWith(renderId));
      return (() => children.map((node) => node === root ? (typeof live === 'function' ? (live as () => unknown)() : live) : node)) as unknown as JSX.Element;
    }), host, { renderId });
  } catch {
    // Solid's development build refuses to create nodes while hydrating (a mismatch); render the
    // island fresh instead, as the production build does on its own.
    disposeIsland();
    output = undefined;
    createRoot((dispose) => {
      mount(dispose);
      // A non-hydratable or mismatched root still needs Solid's insertion effect: a
      // one-time replacement would strand a later placeholder-to-content switch.
      solidInsert(host, () => live as JSX.Element, root.nextSibling, [root]);
    });
  }
  if (output instanceof Node && output !== root && !output.isConnected && root.parentNode === host) host.replaceChild(output, root);
  return disposeIsland;
}

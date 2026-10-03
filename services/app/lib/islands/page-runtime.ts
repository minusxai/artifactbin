/**
 * THE AUTHOR SCRIPT'S RUNTIME (`@mx/page-runtime`), loaded by boot when a page carries a script or declares data.
 *
 *  - `bindPage(store)`: the document's declared names as Solid signals over the page's one store, created in one
 *    `createRoot` per store. The author binds them by the name the markup spells (`import { signal, query, mutation }
 *    from 'page'`): `signal('$region')` is a Value's `[accessor, setter]` whose setter writes the store;
 *    `query('$monthly')` is an accessor of rows with `loading` and `error` accessors and a `ready` promise beside it;
 *    `mutation('$rename')` is an async function that waits for the page's access check, resolves after commit and
 *    rejects with the server's message. One store subscription pushes every change into the signals in one `batch`.
 *  - `exposePage(win, store)`: the same bindings as `window.page` (`get`, `set`, `ready`, `mutation`) for browser sessions.
 *  - `startAuthorModule(...)`: loads the version's module (built at publish, lib/story/document/author-module.server)
 *    with its `solid-js` imports pointed at this build's chunks, hands it the bindings through the `page` module's
 *    global, and mounts every component it exports where the markup placed one (`data-mx-mount`) with Solid's `render`.
 *
 * Solid is the island build's one instance (lib/islands/vendor, contract AUTHOR_VENDOR_EXPORTS): the script, this
 * runtime and the kit share one reactive graph.
 */
import { batch, createRoot, createSignal, untrack, type Accessor, type JSX } from 'solid-js';
import { createComponent, render } from 'solid-js/web';
import type { DataflowStore } from '@/lib/story-runtime/store';
import type { Row, Scalar } from '@/lib/story/data/dataflow';

/** The global the generated `page` module reads at import (author-module.server PAGE_GLOBAL). */
export const PAGE_GLOBAL = '__mxPageBindings';

/** A Value's setter, Solid's shape: a value, or a function of the current one. Returns what it wrote. */
export type ValueSetter = (next: Scalar | ((current: Scalar) => Scalar)) => Scalar;
/** A Query (or table Value): its rows, and the state of the run in flight. */
export type QueryAccessor = Accessor<Row[]> & {
  readonly loading: Accessor<boolean>;
  readonly error: Accessor<string | null>;
  /** The next settled rows: now, if nothing is pending; else after the run in flight lands (rejects on a query error). */
  readonly ready: Promise<Row[]>;
};
export type MutationFn = (args?: Record<string, unknown>) => Promise<void>;

export interface PageBindings {
  /** `signal('$region')`: a declared scalar Value as `[accessor, setter]`. Throws on any other name. */
  signal(ref: string): [Accessor<Scalar>, ValueSetter];
  /** `query('$monthly')`: a Query's (or table Value's) rows. Throws on any other name. */
  query(ref: string): QueryAccessor;
  /** `mutation('$rename')`: a declared Mutation. Throws on any other name. */
  mutation(ref: string): MutationFn;
  /** A Value's or Query's current value as a TRACKED read (a mounted component's `$name` prop), or undefined. */
  read(name: string): (() => Scalar | Row[]) | undefined;
  /** The names this store declares, by kind (window.page and the mounts use these). */
  has(name: string): 'value' | 'query' | 'mutation' | null;
  dispose(): void;
}

interface ValueBinding { get: Accessor<Scalar>; put: (v: Scalar) => void; set: ValueSetter }
interface QueryBinding {
  accessor: QueryAccessor;
  put(rows: Row[] | undefined, loading: boolean, error: string | null): void;
}

const bareName = (ref: string): string => (typeof ref === 'string' && ref.startsWith('$') ? ref.slice(1) : String(ref));
const wrongName = (fn: string, ref: string, want: string): Error =>
  new Error(`page: ${fn}(${JSON.stringify(ref)}) names no declared ${want}; write ${fn}('$name') with a name the Helmet declares`);

const bound = new WeakMap<DataflowStore, PageBindings>();
const NONE: PageBindings = {
  signal: (ref) => { throw wrongName('signal', ref, 'Value'); },
  query: (ref) => { throw wrongName('query', ref, 'Query'); },
  mutation: (ref) => { throw wrongName('mutation', ref, 'Mutation'); },
  read: () => undefined, has: () => null, dispose: () => {},
};

export function bindPage(store: DataflowStore | null): PageBindings {
  if (!store) return NONE;
  const cached = bound.get(store);
  if (cached) return cached;
  return createRoot((disposeRoot) => {
    const state = store.getState();
    const values = new Map<string, ValueBinding>();
    const queries = new Map<string, QueryBinding>();
    const mutations = new Map<string, MutationFn>();
    const pending0 = store.pending();

    const valueBinding = (name: string, initial: Scalar): ValueBinding => {
      const [get, put] = createSignal<Scalar>(initial);
      const set: ValueSetter = (next) => {
        const value = typeof next === 'function' ? next(untrack(get)) : next;
        store.setValue(name, value);
        return value;
      };
      return { get, put: (v) => { put(() => v); }, set };
    };
    const queryBinding = (name: string, initialRows: Row[], initialLoading: boolean, initialError: string | null): QueryBinding => {
      const [rows, setRows] = createSignal<Row[]>(initialRows);
      const [loading, setLoading] = createSignal(initialLoading);
      const [error, setError] = createSignal<string | null>(initialError);
      let waiters: Array<{ resolve: (rows: Row[]) => void; reject: (error: Error) => void }> = [];
      const accessor = Object.defineProperties((() => rows()) as QueryAccessor, {
        loading: { value: loading, enumerable: true },
        error: { value: error, enumerable: true },
        ready: {
          enumerable: true,
          get: (): Promise<Row[]> => {
            if (!untrack(loading)) {
              const failed = untrack(error);
              return failed ? Promise.reject(new Error(failed)) : Promise.resolve(untrack(rows));
            }
            return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
          },
        },
        name: { value: name },
      });
      return {
        accessor,
        put(next, nextLoading, nextError) {
          if (next && untrack(rows) !== next) setRows(() => next);
          if (untrack(error) !== nextError) setError(nextError);
          if (untrack(loading) !== nextLoading) setLoading(nextLoading);
          if (!nextLoading && waiters.length) {
            const settled = waiters; waiters = [];
            const current = untrack(rows);
            for (const w of settled) nextError ? w.reject(new Error(nextError)) : w.resolve(current);
          }
        },
      };
    };

    for (const decl of store.flow.values) {
      if (decl.kind === 'scalar' && decl.type !== 'table') values.set(decl.name, valueBinding(decl.name, state.values[decl.name] ?? null));
      else queries.set(decl.name, queryBinding(decl.name, state.tables[decl.name]?.rows ?? [], pending0.has(decl.name), state.errors[decl.name] ?? null));
    }
    for (const decl of store.flow.queries) queries.set(decl.name, queryBinding(decl.name, state.tables[decl.name]?.rows ?? [], pending0.has(decl.name), state.errors[decl.name] ?? null));
    for (const decl of store.flow.mutations) {
      mutations.set(decl.name, async (args = {}) => {
        const { _row, ...scalars } = args as { _row?: Record<string, Scalar> } & Record<string, Scalar>;
        // A mutation called right after load must not be refused while the page is still checking edit access.
        await store.accessSettled();
        await store.mutate(decl.name, scalars, _row);
      });
    }

    const sync = () => {
      const next = store.getState();
      const pending = store.pending();
      batch(() => {
        for (const [name, binding] of values) {
          const v = next.values[name] ?? null;
          if (untrack(binding.get) !== v) binding.put(v);
        }
        for (const [name, binding] of queries) binding.put(next.tables[name]?.rows, pending.has(name), next.errors[name] ?? null);
      });
    };
    const stop = store.subscribe(sync);

    const bindings: PageBindings = {
      signal(ref) {
        const binding = values.get(bareName(ref));
        if (!binding) throw wrongName('signal', ref, 'Value');
        return [binding.get, binding.set];
      },
      query(ref) {
        const binding = queries.get(bareName(ref));
        if (!binding) throw wrongName('query', ref, 'Query or table Value');
        return binding.accessor;
      },
      mutation(ref) {
        const fn = mutations.get(bareName(ref));
        if (!fn) throw wrongName('mutation', ref, 'Mutation');
        return fn;
      },
      read(name) {
        const value = values.get(name);
        if (value) return value.get;
        const query = queries.get(name);
        return query ? query.accessor : undefined;
      },
      has: (name) => (values.has(name) ? 'value' : queries.has(name) ? 'query' : mutations.has(name) ? 'mutation' : null),
      dispose: () => { stop(); bound.delete(store); disposeRoot(); },
    };
    bound.set(store, bindings);
    return bindings;
  });
}

/**
 * What `window.page` holds, for a browser session to drive the page: plain data in and out, never a signal.
 *  - `get(name)`: a Value's current value or a Query's current rows (undefined for an undeclared name);
 *  - `set(name, value)`: write a Value (bound markup re-renders, dependent queries re-run);
 *  - `ready(name)`: a Query's next settled rows;
 *  - `mutation(name)`: a Mutation's async function (undefined for an undeclared name).
 */
export interface PublicPage {
  get(name: string): Scalar | Row[] | undefined;
  set(name: string, value: Scalar): void;
  ready(name: string): Promise<Row[]>;
  mutation(name: string): MutationFn | undefined;
}
declare global { interface Window { page?: PublicPage } }

/**
 * Install `window.page` over this store's bindings (the same signals the script binds from `page`). Returns its
 * remover, which also drops the bindings (boot calls it on edit and dispose).
 */
export function exposePage(win: Window, store: DataflowStore): () => void {
  const bindings = bindPage(store);
  const api: PublicPage = Object.freeze({
    get: (name: string) => { const read = bindings.read(bareName(name)); return read ? untrack(read) : undefined; },
    set: (name: string, value: Scalar) => { bindings.signal(`$${bareName(name)}`)[1](value); },
    ready: (name: string) => bindings.query(`$${bareName(name)}`).ready,
    mutation: (name: string) => (bindings.has(bareName(name)) === 'mutation' ? bindings.mutation(`$${bareName(name)}`) : undefined),
  });
  win.page = api;
  return () => { if (win.page === api) delete win.page; bindings.dispose(); };
}

/** Where the markup placed a component the script exports (compiler `data-mx-mount`). */
const MOUNT_ATTR = 'data-mx-mount';
const PROPS_ATTR = 'data-mx-props';
const BIND_ATTR = 'data-mx-bind';

type ComponentModule = Record<string, unknown>;
type Component = (props: Record<string, unknown>) => JSX.Element;

/**
 * Render every exported component the markup placed, with Solid's `render`. Literal props arrive as values; a `$name`
 * prop is a GETTER on the props object over that Value's or Query's signal, so `props.rows` tracks where it is read
 * (Solid's own convention: do not destructure props). Returns the unmount: each root disposed, its fallback restored.
 */
export function mountComponents(root: ParentNode, mod: ComponentModule, bindings: PageBindings): () => void {
  const mounted: Array<[Element, ChildNode[], () => void]> = [];
  for (const el of root.querySelectorAll(`[${MOUNT_ATTR}]`)) {
    const name = el.getAttribute(MOUNT_ATTR) ?? '';
    const component = mod[name];
    if (typeof component !== 'function') { console.error(`[page] the script exports no component named ${name}`); continue; }
    const props: Record<string, unknown> = {};
    try { Object.assign(props, JSON.parse(el.getAttribute(PROPS_ATTR) || '{}') as Record<string, unknown>); } catch { /* a compiler writes valid JSON */ }
    let bind: Record<string, string> = {};
    try { bind = JSON.parse(el.getAttribute(BIND_ATTR) || '{}') as Record<string, string>; } catch { /* idem */ }
    for (const [prop, declared] of Object.entries(bind)) {
      const read = bindings.read(declared);
      if (read) Object.defineProperty(props, prop, { get: read, enumerable: true, configurable: true });
      else console.error(`[page] <${name} ${prop}> binds $${declared}, which is not declared`);
    }
    // The server-rendered children are the fallback: kept aside while the component renders, put back when it
    // unmounts (edit mode stops the script), so the mount never shows as a hole.
    const fallback = [...el.childNodes];
    el.replaceChildren();
    try {
      const dispose = render(() => createComponent(component as Component, props), el);
      mounted.push([el, fallback, dispose]);
    } catch (error) {
      console.error(`[page] <${name}> failed to render`, error);
      el.replaceChildren(...fallback);
    }
  }
  return () => {
    for (const [el, fallback, dispose] of mounted) {
      dispose();
      if (el.isConnected) el.replaceChildren(...fallback);
    }
  };
}

export interface AuthorModuleStart {
  /** The module as built at publish: bare vendor specifiers, the `page` module inlined. */
  source: string;
  store: DataflowStore | null;
  root: ParentNode;
  /** Vendor specifier → this build's chunk URL (IslandPageData.vendor). */
  vendor: Readonly<Record<string, string>>;
}

/** Point the module's bare vendor imports at this build's chunks, so the script, the runtime and the kit share one Solid. */
export function resolveVendorImports(source: string, vendor: Readonly<Record<string, string>>, base: string = typeof document === 'undefined' ? 'http://localhost/' : document.baseURI): string {
  // Absolute URLs: a blob: module has no hierarchical base, so a root-relative chunk path would not resolve from it.
  vendor = Object.fromEntries(Object.entries(vendor).map(([spec, url]) => [spec, new URL(url, base).href]));
  const specifiers = Object.keys(vendor).sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|');
  if (!specifiers) return source;
  return source.replace(new RegExp(`(["'])(${specifiers})\\1`, 'g'), (match, quote: string, spec: string) => (vendor[spec] ? `${quote}${vendor[spec]}${quote}` : match));
}

/** Run the version's module in this document. Returns the stop function: unmounts its components and drops its bindings. */
export async function startAuthorModule(input: AuthorModuleStart): Promise<() => void> {
  const bindings = bindPage(input.store);
  (globalThis as Record<string, unknown>)[PAGE_GLOBAL] = bindings;
  const code = resolveVendorImports(input.source, input.vendor);
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  let mod: ComponentModule;
  try { mod = (await import(/* @vite-ignore */ url)) as ComponentModule; }
  finally { URL.revokeObjectURL(url); }
  const unmount = mountComponents(input.root, mod, bindings);
  return () => { unmount(); };
}

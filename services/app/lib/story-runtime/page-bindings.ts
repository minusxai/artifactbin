/** Shared page signal bindings: browser author modules and headless Lambda programs use one store contract. */
import { batch, createRoot, createSignal, untrack, type Accessor } from 'solid-js';
import type { DataflowStore } from './store';
import type { DatasetUploadResult } from '@artifactbin/contracts';
import type { Row, Scalar } from '@/lib/dataflow/dataflow';

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
  upload(importName:string,file:File):Promise<DatasetUploadResult>;
  fileUrl(importName:string,ref:unknown):string;
  uploadImage(importName:string,file:File):Promise<{ref:string;url:string}>;
  imageUrl(importName:string,ref:unknown):string;
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
  upload: () => Promise.reject(new Error('page.upload is unavailable')),
  fileUrl: () => '',
  uploadImage: () => Promise.reject(new Error('page.uploadImage is unavailable')),
  imageUrl: () => '',
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
      upload(importName,file) {
        if(typeof document==='undefined')return Promise.reject(new Error('page.upload requires a browser page'));
        const found=store.flow.imports.find(item=>item.name===bareName(importName));
        if(!found)return Promise.reject(new Error(`page.upload(${JSON.stringify(importName)}) names no declared dataset import`));
        // File bytes are an optional browser interaction; keep their transport out of reader readiness.
        return import('./file-upload').then(({ uploadDatasetFile }) => uploadDatasetFile(store.image,found.ref.replace(/^ref:/,''),document.body.getAttribute('data-mx-live-edit')??'',file));
      },
      fileUrl(importName,ref) {
        const found=store.flow.imports.find(item=>item.name===bareName(importName));
        const match=typeof ref==='string'?/^(dimg|dfile):([a-z0-9]+)$/.exec(ref):null;
        if(!found||!match)return '';
        const docId=typeof document==='undefined'?'':document.body.getAttribute('data-mx-live-id')??'';
        if(!docId)return '';
        return `${globalThis.location?.origin??''}/a/${encodeURIComponent(docId)}/datasets/${encodeURIComponent(found.ref.replace(/^ref:/,''))}/${match[1]==='dimg'?'images':'files'}/${encodeURIComponent(match[2]!)}`;
      },
      uploadImage(importName,file) {
        if(typeof document==='undefined')return Promise.reject(new Error('page.uploadImage requires a browser page'));
        const found=store.flow.imports.find(item=>item.name===bareName(importName));
        if(!found)return Promise.reject(new Error(`page.uploadImage(${JSON.stringify(importName)}) names no declared dataset import`));
        return import('./image-upload').then(({ uploadDatasetImage }) => uploadDatasetImage(store.image,found.ref.replace(/^ref:/,''),document.body.getAttribute('data-mx-live-edit')??'',file));
      },
      imageUrl(importName,ref) {
        return typeof ref==='string'&&/^dimg:[a-z0-9]+$/.test(ref)?bindings.fileUrl(importName,ref):'';
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

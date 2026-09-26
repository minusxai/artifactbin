import { runtimeId } from './runtime-id';
/** One capability implementation for the public page and the managed iframe transport. */
import type { MxApi, MxSnapshot, MxReadOptions } from '@artifactbin/contracts';
import { DECL_NAME_RE, scalarMatches, type Scalar } from '@/lib/story/dataflow';
import type { CompiledMutation } from '@/lib/story/compiled-dataflow';
import { ACCESS_PENDING, type DataflowStore } from './store';

export type { MxApi } from '@artifactbin/contracts';
declare global { interface Window { mx?: MxApi } }

const instances = new WeakMap<DataflowStore, { key: string; api: MxApi }>();
const flowKeys = new WeakMap<DataflowStore['flow'], string>();
/** Source offsets and prose edits do not create a new data lifetime. */
export function mxFlowKey(flow: DataflowStore['flow']): string {
  let key = flowKeys.get(flow);
  if (key === undefined) {
    key = JSON.stringify([flow.imports, flow.values, flow.queries, flow.mutations].map(group => group.map((declaration) => {
      const { start: _start, end: _end, ...rest } = declaration as typeof declaration & { start?: number; end?: number };
      return rest;
    })));
    flowKeys.set(flow, key);
  }
  return key;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (code: string, message: string, snapshot?: MxSnapshot) => Object.assign(new Error(message), { code, ...(snapshot ? { snapshot } : {}) });
const validScalar = (value: unknown): value is Scalar => value === null || typeof value === 'boolean'
  || (typeof value === 'string' && value.length <= 65536) || (typeof value === 'number' && Number.isFinite(value));

/** A mutation's scope for a script: a dataset write, or the reader's own table Value. */
const scopeOf = (m: CompiledMutation): 'dataset' | 'local' => ('import' in m.target ? 'dataset' : 'local');
/** What `mx.mutate` accepts: the signature's arguments, and the row / edited value the statement reads. */
const argumentsOf = (m: CompiledMutation): string[] => [
  ...m.args.map((a) => a.name),
  ...(m.reads.builtins.some((b) => b.startsWith('_row.')) ? ['_row'] : []),
  ...(m.reads.builtins.includes('_value') ? ['_value'] : []),
];

export function createMx(store: DataflowStore): MxApi {
  const cached = instances.get(store);
  const key = mxFlowKey(store.flow);
  if (cached?.key === key) return cached.api;
  const flow = store.flow;
  const instanceEpoch = runtimeId();
  let revision = 0;
  const alive = () => {
    if (store.disposed || mxFlowKey(store.flow) !== key) throw fail('STALE_INSTANCE', 'This artifact instance has been replaced or closed');
  };
  const stopRevision = store.subscribe(() => {
    revision++;
    if (store.disposed || mxFlowKey(store.flow) !== key) stopRevision();
  });
  const declarations = [...flow.values, ...flow.queries];
  const validateNames = (names: string[]) => {
    alive();
    if (!Array.isArray(names) || names.length > 256 || names.some(name => typeof name !== 'string' || !declarations.some(d => d.name === name))) {
      throw fail('UNKNOWN_SIGNAL', 'Expected up to 256 declared signal names');
    }
  };
  const validatePatch = (values: unknown): Record<string, Scalar> => {
    if (!record(values) || Object.keys(values).length > 256) throw fail('INVALID_PATCH', 'Expected an object with up to 256 scalar values');
    for (const [name, value] of Object.entries(values)) {
      const decl = flow.values.find(d => d.name === name);
      if (!decl || decl.kind !== 'scalar' || decl.type === 'table') throw fail('NOT_WRITABLE', `Signal ${name} is not a writable scalar`);
      if (!validScalar(value) || !scalarMatches(value, decl.type)) throw fail('INVALID_VALUE', `Invalid ${decl.type} value for ${name}`);
    }
    return values as Record<string, Scalar>;
  };
  const snapshot = (names: string[]): MxSnapshot => {
    alive();
    const state = store.getState();
    return structuredClone({ instanceEpoch, revision, signals: Object.fromEntries(names.map(name => [name, {
      value: Object.hasOwn(state.values, name) ? state.values[name]! : state.tables[name] ?? null,
      status: store.pending().has(name) ? 'pending' : state.errors[name] ? 'error' : 'ready',
      ...(state.errors[name] ? { error: { code: 'QUERY_ERROR', message: state.errors[name] } } : {}),
    }])) });
  };
  const api: MxApi = {
    async describe() {
      alive();
      return structuredClone({ instanceEpoch,
        signals: declarations.map(d => ({ name: d.name, kind: 'kind' in d ? d.kind : 'query' as const, writable: 'kind' in d && d.kind === 'scalar',
          ...('kind' in d && d.type !== 'table' ? { type: d.type } : {}), ...('kind' in d && d.columns ? { columns: d.columns } : store.getTable(d.name) ? { columns: store.getTable(d.name)!.columns } : {}),
          // Reported only where the declaration carries it, so a document that
          // asked for neither describes itself exactly as it did before.
          ...('url' in d && d.url === false ? { url: false as const } : {}),
        })),
        mutations: flow.mutations.map(d => ({ name: d.name, scope: scopeOf(d), args: argumentsOf(d),
          available: store.canMutate(d.name), unavailableReason: store.mutationUnavailable(d.name),
          ...(d.reset?.length ? { reset: d.reset } : {}) })),
      });
    },
    async read(names, options: MxReadOptions = {}) {
      validateNames(names);
      names = [...names];
      if (!record(options) || Object.keys(options).some(key => !['wait', 'refresh', 'timeoutMs'].includes(key))
        || (options.wait !== undefined && typeof options.wait !== 'boolean')
        || (options.refresh !== undefined && typeof options.refresh !== 'boolean')
        || (options.timeoutMs !== undefined && (typeof options.timeoutMs !== 'number' || !Number.isFinite(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 30000))) {
        throw fail('INVALID_OPTIONS', 'Read accepts wait, refresh, and timeoutMs between 1 and 30000');
      }
      if (options.refresh) {
        if (names.some(name => !flow.queries.some(q => q.name === name))) throw fail('NOT_QUERY', 'Only query signals can be refreshed');
        store.refresh(names);
      }
      if (options.wait || options.refresh) {
        const deadline = Date.now() + (options.timeoutMs ?? 10000);
        while (names.some(name => store.pending().has(name))) {
          alive();
          if (Date.now() >= deadline) throw fail('TIMEOUT', 'Signals did not settle before the read deadline', snapshot(names));
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      return snapshot(names);
    },
    async set(values) {
      alive();
      store.setValues(validatePatch(values));
      return { instanceEpoch, revision };
    },
    async mutate(name, args = {}) {
      alive();
      const decl = flow.mutations.find(d => d.name === name);
      if (!decl) throw fail('UNKNOWN_MUTATION', 'Expected a declared mutation name');
      if (!record(args) || Object.keys(args).some(key => !argumentsOf(decl).includes(key))) throw fail('UNKNOWN_ARGUMENT', 'Only the mutation’s declared arguments can be supplied');
      const { _row, _value, ...scalars } = args;
      if (Object.keys(scalars).length > 256 || Object.values(scalars).some((v) => !validScalar(v))) throw fail('INVALID_VALUE', 'Arguments must be scalars');
      const values = scalars as Record<string, Scalar>;
      let row: Record<string, Scalar> | undefined;
      if (_row !== undefined) {
        if (!record(_row) || Object.keys(_row).length > 256 || Object.entries(_row).some(([key, value]) => !DECL_NAME_RE.test(key) || !validScalar(value))) throw fail('INVALID_VALUE', 'Row arguments must be named scalars');
        row = _row as Record<string, Scalar>;
      }
      if (_value !== undefined) {
        if (!validScalar(_value)) throw fail('INVALID_VALUE', 'Cell value must be a scalar');
        values._value = _value;
      }
      if (store.mutating().has(name)) throw fail('BUSY', `Mutation ${name} is already running`);
      // The first query also answers WHO MAY WRITE; a script that calls mutate
      // the moment `window.mx` exists would otherwise be refused with the
      // placeholder. Wait for the answer, then refuse with the real reason.
      if (store.mutationUnavailable(name) === ACCESS_PENDING) await store.accessSettled();
      if (!store.canMutate(name)) throw fail('FORBIDDEN', store.mutationUnavailable(name) ?? 'Mutation is unavailable');
      const operationId = runtimeId();
      await store.mutate(name, values, row);
      return { operationId, scope: scopeOf(decl), status: 'committed' };
    },
    subscribe(names, callback) {
      validateNames(names);
      names = [...names];
      if (typeof callback !== 'function') throw fail('INVALID_CALLBACK', 'Expected a snapshot callback');
      let active = true;
      let previous: string | undefined;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const stop = () => { active = false; unsubscribe(); clearTimeout(timer); };
      const schedule = () => {
        if (!active || timer !== undefined) return;
        if (store.disposed || mxFlowKey(store.flow) !== key) { stop(); return; }
        timer = setTimeout(() => {
          timer = undefined;
          if (!active) return;
          if (store.disposed || mxFlowKey(store.flow) !== key) { stop(); return; }
          const next = snapshot(names);
          const signature = JSON.stringify(next.signals);
          if (signature === previous) return;
          previous = signature;
          try { callback(next); } catch (error) { console.error('mx subscription callback failed', error); }
        }, 0);
      };
      const unsubscribe = store.subscribe(schedule);
      schedule();
      return stop;
    },
  };
  Object.freeze(api);
  instances.set(store, { key, api });
  return api;
}

/** The owner must uninstall on disposal and reinstall after replacing declarations. */
export function installMx(store: DataflowStore): MxApi {
  const api = createMx(store);
  if (typeof window !== 'undefined') window.mx = api;
  return api;
}

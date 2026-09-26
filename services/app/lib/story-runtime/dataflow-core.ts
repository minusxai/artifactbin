/**
 * THE RUNTIME STORE'S DECISIONS, AS A PURE REDUCER: `(state, event) → { state,
 * effects }`. The store (lib/story-runtime/store) is the shell around it — it
 * owns the transport, the timer, the listeners and the promises — and every
 * question of what is current, what to run and which answer to keep is
 * answered here, where a test can replay any interleaving without a clock.
 *
 * NODES AND VERSIONS. The graph (lib/story-runtime/runtime-graph) has inputs
 * (scalar and table values), sources (dataset ids, `_members`, the viewer) and
 * computed nodes: every query, and one write check per dataset mutation ("may
 * this viewer run it now"). Every node has a version, bumped from one clock
 * when it changes. A computed node's version is the largest version among
 * itself and everything it reads, so it moves exactly when one of those moves;
 * its answer is CURRENT when it was computed at that version.
 *
 * That is the whole scheduling rule. A flush asks for every computed node that
 * is not current and not already asked for at its version, in ONE request; an
 * answer is applied to each node it covers whose version has not moved since,
 * and dropped for the rest — they are stale, and whatever moved them already
 * asked (or scheduled a flush to ask) again. A run for `sales` therefore
 * survives a later run for `trend`: nothing either one reads moved the other.
 */
import type { DataflowState, Row, Scalar, TableResult } from '@/lib/story/dataflow';
import { checkedLocalRows } from '@/lib/story/local-tables';
import { graphDefaults, graphInlineTables, type GraphReads, type RuntimeGraph } from './runtime-graph';
import type { MutationAnswer } from './store';

/** What one run answers: rows and errors for its queries, and the write checks. */
export type RunAnswer = Pick<DataflowState, 'tables' | 'errors' | 'mutationAccess' | 'userOptions' | 'people'>;

/** A node, by kind and name: `value:region`, `source:abc123`, `query:sales`, `access:vote`, `mutation:add`. */
type NodeKey = string;
/** The version each requested node was asked at — what its answer is judged by. */
export type Versions = Readonly<Record<NodeKey, number>>;

const valueKey = (name: string): NodeKey => `value:${name}`;
const sourceKey = (id: string): NodeKey => `source:${id}`;
const queryKey = (name: string): NodeKey => `query:${name}`;
const accessKey = (name: string): NodeKey => `access:${name}`;
const mutationKey = (name: string): NodeKey => `mutation:${name}`;

interface LocalWrite { id: number; name: string; overrides?: Record<string, Scalar>; row?: Record<string, Scalar> }

export interface CoreState {
  readonly graph: RuntimeGraph;
  readonly clock: number;
  /** Each node's own version: bumped when it changes (a value set, a source written, a query refreshed). */
  readonly versions: Readonly<Record<NodeKey, number>>;
  /** The version each computed node's answer belongs to. */
  readonly answered: Readonly<Record<NodeKey, number>>;
  /** The version of the newest request outstanding per node — what keeps a flush from asking twice. */
  readonly requested: Readonly<Record<NodeKey, number>>;
  /** Write checks whose run failed at this version: the last answer stands and the next flush asks again. */
  readonly failed: Readonly<Record<NodeKey, number>>;
  /** The snapshot every consumer reads: a new object exactly when something readable changed. */
  readonly data: DataflowState;
  /** Table values the reader's local writes replaced; they travel with every run. */
  readonly local: Readonly<Record<string, TableResult>>;
  /** Writes in flight, counted by name (row writes are not deduplicated). */
  readonly busy: Readonly<Record<string, number>>;
  /** Local writes run one at a time, each against the state the one before it committed. */
  readonly localQueue: readonly LocalWrite[];
  /** The local write running now, and the version of what it read. */
  readonly localHead: (LocalWrite & { at: number }) | null;
  readonly disposed: boolean;
}

export type CoreEvent =
  | { type: 'set'; values: Record<string, Scalar> }
  | { type: 'flush' }
  | { type: 'answered'; at: Versions; answer: RunAnswer }
  | { type: 'failed'; at: Versions; error: unknown }
  | { type: 'sources'; ids: readonly string[] }
  | { type: 'refresh'; queries?: readonly string[] }
  | { type: 'replace'; graph: RuntimeGraph; state?: DataflowState }
  | { type: 'write'; id: number; name: string; overrides?: Record<string, Scalar>; row?: Record<string, Scalar> }
  | { type: 'written'; id: number; name: string; answer: MutationAnswer }
  | { type: 'writeFailed'; id: number; name: string; error: unknown }
  /** Something the shell owns changed (the transport): readers must look again. */
  | { type: 'touch' }
  | { type: 'dispose' };

export type CoreEffect =
  /** Compute these nodes at these versions: `only` are its queries; any `access:` key asks for write checks too. */
  | { type: 'run'; at: Versions; only: string[]; values: Record<string, Scalar>; localTables?: Record<string, Row[]> }
  /** Perform a write. `localTables` is present exactly for a local write. */
  | { type: 'write'; id: number; name: string; values: Record<string, Scalar>; row?: Record<string, Scalar>; localTables?: Record<string, Row[]> }
  | { type: 'settle'; id: number; outcome: { ok: true } | { ok: false; error: unknown } }
  | { type: 'notify' };

// ── the graph, as nodes ─────────────────────────────────────────────────────

interface GraphIndex {
  /** Every node a computed node's version is taken over: itself and every input and source it reads, transitively. */
  leaves: Map<NodeKey, readonly NodeKey[]>;
  /** Queries (run order), then write checks: every node a flush may ask for. */
  computed: readonly NodeKey[];
  /** Every node key the graph declares. */
  nodes: readonly NodeKey[];
  sources: ReadonlySet<string>;
  scalars: ReadonlyMap<string, string>;
}

const indexes = new WeakMap<RuntimeGraph, GraphIndex>();

function indexOf(graph: RuntimeGraph): GraphIndex {
  const cached = indexes.get(graph);
  if (cached) return cached;
  const direct = (reads: GraphReads): NodeKey[] => [...reads.values.map(valueKey), ...reads.sources.map(sourceKey)];
  const leaves = new Map<NodeKey, readonly NodeKey[]>();
  // Run order puts every upstream query first, so its leaves are already known.
  for (const q of graph.queries) {
    const own = new Set([queryKey(q.name), ...direct(q.reads)]);
    for (const u of q.reads.queries) for (const k of leaves.get(queryKey(u)) ?? []) if (k !== queryKey(u)) own.add(k);
    leaves.set(queryKey(q.name), [...own]);
  }
  for (const m of graph.mutations) {
    const self = 'source' in m.target ? accessKey(m.name) : mutationKey(m.name);
    leaves.set(self, [self, ...direct(m.reads)]);
  }
  const index: GraphIndex = {
    leaves,
    computed: [...graph.queries.map((q) => queryKey(q.name)), ...graph.mutations.filter((m) => 'source' in m.target).map((m) => accessKey(m.name))],
    nodes: [...new Set([...graph.values.map((v) => valueKey(v.name)), ...[...leaves.values()].flat()])],
    sources: new Set([...graph.queries, ...graph.mutations].flatMap((n) => n.reads.sources)),
    scalars: new Map(graph.values.flatMap((v) => v.kind === 'scalar' ? [[v.name, v.type] as const] : [])),
  };
  indexes.set(graph, index);
  return index;
}

const versionOf = (state: CoreState, node: NodeKey): number =>
  Math.max(...(indexOf(state.graph).leaves.get(node) ?? [node]).map((k) => state.versions[k] ?? 0));

const isCurrent = (state: CoreState, node: NodeKey): boolean => state.answered[node] === versionOf(state, node);

const pendingSets = new WeakMap<CoreState, ReadonlySet<string>>();

/**
 * The queries whose rows are not current — asked for or not. Memoised per
 * state, so it is the same object until the state changes (a
 * `useSyncExternalStore` snapshot must be).
 */
export function pendingOf(state: CoreState): ReadonlySet<string> {
  let set = pendingSets.get(state);
  if (!set) {
    set = new Set(state.graph.queries.filter((q) => !isCurrent(state, queryKey(q.name))).map((q) => q.name));
    pendingSets.set(state, set);
  }
  return set;
}

const busySets = new WeakMap<object, ReadonlySet<string>>();

/** The writes in flight by name; the same object until one starts or ends. */
export function busyOf(state: CoreState): ReadonlySet<string> {
  let set = busySets.get(state.busy);
  if (!set) { set = new Set(Object.keys(state.busy)); busySets.set(state.busy, set); }
  return set;
}

/** Every write check has an answer at its version, or failed at it and waits for the next flush. */
export const accessSettled = (state: CoreState): boolean =>
  indexOf(state.graph).computed.every((k) => !k.startsWith('access:') || isCurrent(state, k) || state.failed[k] === versionOf(state, k));

/** The local table rows every run and write carries, when the reader has written any. */
export function localRows(state: CoreState): Record<string, Row[]> | undefined {
  const names = Object.keys(state.local);
  return names.length ? Object.fromEntries(names.map((n) => [n, state.local[n]!.rows])) : undefined;
}

// ── construction ────────────────────────────────────────────────────────────

/**
 * A document's starting state. `state` present means somebody already ran the
 * queries with these values (a capture, the editor's canvas): they start
 * current. Absent, nothing has run and every query starts pending.
 */
export function createCore(graph: RuntimeGraph, seed: { state?: DataflowState; values?: Record<string, Scalar> }): CoreState {
  const { state, values } = seed;
  const answered: Record<NodeKey, number> = {};
  for (const k of indexOf(graph).computed) {
    if (k.startsWith('query:') ? state : state?.mutationAccess) answered[k] = 0;
  }
  return {
    graph, clock: 0, versions: {}, answered, requested: {}, failed: {},
    data: {
      values: { ...graphDefaults(graph), ...(state?.values ?? {}), ...(values ?? {}) },
      tables: { ...graphInlineTables(graph), ...(state?.tables ?? {}) },
      errors: { ...(state?.errors ?? {}) },
      mutationAccess: state?.mutationAccess ?? {},
      userOptions: state?.userOptions ?? {}, people: state?.people ?? {},
    },
    local: {}, busy: {}, localQueue: [], localHead: null, disposed: false,
  };
}

// ── the reducer ─────────────────────────────────────────────────────────────

export function step(prev: CoreState, event: CoreEvent): { state: CoreState; effects: CoreEffect[] } {
  const effects: CoreEffect[] = [];
  const next = reduce(prev, event, effects);
  if (next === prev) return { state: prev, effects };
  const pendingBefore = pendingOf(prev), pendingAfter = pendingOf(next);
  const readable = next.data !== prev.data || next.busy !== prev.busy
    || pendingBefore.size !== pendingAfter.size || [...pendingAfter].some((n) => !pendingBefore.has(n));
  if (!readable) return { state: next, effects };
  // A new snapshot identity whenever anything a reader sees changed, pending
  // and busy included: the runtime re-renders from `getState()` and reads the
  // rest during that render.
  return { state: next.data === prev.data ? { ...next, data: { ...next.data } } : next, effects: [...effects, { type: 'notify' }] };
}

function reduce(state: CoreState, event: CoreEvent, effects: CoreEffect[]): CoreState {
  if (state.disposed) {
    // The document is gone; a write that was already on the wire still answers its caller.
    if (event.type === 'written' || event.type === 'writeFailed') {
      effects.push(event.type === 'written' && state.localHead?.id !== event.id
        ? { type: 'settle', id: event.id, outcome: { ok: true } }
        : { type: 'settle', id: event.id, outcome: { ok: false, error: event.type === 'writeFailed' ? event.error : new Error(LOCAL_CHANGED) } });
    }
    return state;
  }
  switch (event.type) {
    case 'set': return setValues(state, event.values);
    case 'flush': return flush(state, effects);
    case 'answered': return answered(state, event.at, event.answer);
    case 'failed': return failed(state, event.at, event.error);
    case 'sources': return bumpSources(state, event.ids);
    case 'refresh': {
      const declared = new Set(state.graph.queries.map((q) => q.name));
      return bump(state, (event.queries ?? [...declared]).filter((n) => declared.has(n)).map(queryKey));
    }
    case 'replace': return replace(state, event.graph, event.state, effects);
    case 'write': return write(state, event, effects);
    case 'written': case 'writeFailed': return written(state, event, effects);
    case 'touch': return { ...state, data: { ...state.data } };
    case 'dispose': {
      for (const w of state.localQueue) effects.push({ type: 'settle', id: w.id, outcome: { ok: false, error: new Error(DOCUMENT_CHANGED) } });
      return { ...state, disposed: true, localQueue: [] };
    }
  }
}

const LOCAL_CHANGED = 'Local state changed while mutation ran; retry';
const DOCUMENT_CHANGED = 'Document changed before local mutation ran';

function bump(state: CoreState, keys: readonly NodeKey[]): CoreState {
  if (!keys.length) return state;
  const clock = state.clock + 1;
  const versions = { ...state.versions };
  for (const k of keys) versions[k] = clock;
  return { ...state, clock, versions };
}

/** Set declared scalars; undeclared names and unchanged values are ignored. */
function setValues(state: CoreState, values: Record<string, Scalar>): CoreState {
  const scalars = indexOf(state.graph).scalars;
  const changed = Object.keys(values).filter((k) => scalars.has(k) && !Object.is(state.data.values[k], values[k]));
  if (!changed.length) return state;
  const nextValues = { ...state.data.values };
  for (const k of changed) nextValues[k] = values[k]!;
  return { ...bump(state, changed.map(valueKey)), data: { ...state.data, values: nextValues } };
}

/** A source changed elsewhere; ids nothing in this document reads cost nothing. */
function bumpSources(state: CoreState, ids: readonly string[]): CoreState {
  const read = indexOf(state.graph).sources;
  return bump(state, ids.filter((id) => read.has(id)).map(sourceKey));
}

function flush(state: CoreState, effects: CoreEffect[]): CoreState {
  const at: Record<NodeKey, number> = {};
  for (const k of indexOf(state.graph).computed) {
    const v = versionOf(state, k);
    if (state.answered[k] !== v && state.requested[k] !== v) at[k] = v;
  }
  if (!Object.keys(at).length) return state;
  // Asked again: a failed write check is in flight now, not settled.
  const failedAt = { ...state.failed };
  for (const k of Object.keys(at)) delete failedAt[k];
  const tables = localRows(state);
  effects.push({
    type: 'run', at,
    only: state.graph.queries.filter((q) => Object.hasOwn(at, queryKey(q.name))).map((q) => q.name),
    values: { ...state.data.values },
    ...(tables ? { localTables: tables } : {}),
  });
  return { ...state, requested: { ...state.requested, ...at }, failed: failedAt };
}

/** The name inside a computed node's key. */
const nameOf = (k: NodeKey): string => k.slice(k.indexOf(':') + 1);

function answered(state: CoreState, at: Versions, answer: RunAnswer): CoreState {
  const requested = { ...state.requested };
  const current: NodeKey[] = [];
  for (const [k, v] of Object.entries(at)) {
    if (requested[k] === v) delete requested[k];
    if (versionOf(state, k) === v) current.push(k);
  }
  if (!current.length) return { ...state, requested };
  const answeredAt = { ...state.answered }, failedAt = { ...state.failed };
  let { tables, errors, mutationAccess } = state.data;
  for (const k of current) {
    answeredAt[k] = at[k]!;
    delete failedAt[k];
    const name = nameOf(k);
    if (k.startsWith('query:')) {
      if (tables === state.data.tables) { tables = { ...tables }; errors = { ...errors }; }
      delete tables[name]; delete errors[name];
      if (Object.hasOwn(answer.tables, name)) tables[name] = answer.tables[name]!;
      if (Object.hasOwn(answer.errors, name)) errors[name] = answer.errors[name]!;
    } else {
      if (mutationAccess === state.data.mutationAccess) mutationAccess = { ...mutationAccess };
      if (answer.mutationAccess && Object.hasOwn(answer.mutationAccess, name)) mutationAccess![name] = answer.mutationAccess[name]!;
      else delete mutationAccess![name];
    }
  }
  return {
    ...state, requested, answered: answeredAt, failed: failedAt,
    data: { ...state.data, tables, errors, mutationAccess, ...mergedPeople(state.data, current, answer) },
  };
}

/**
 * What an answer says beside its rows, merged PER NODE: a run answers part of
 * the graph (the browser's queries, or the server's), so the pickers' options
 * of a query it answered (`<query>.<column>`) are replaced, every other
 * query's are kept, a Value's picker takes the newest the server sent, and
 * the people it names join those already known. An answer carrying neither —
 * every browser run — changes neither.
 */
function mergedPeople(data: DataflowState, answeredKeys: readonly NodeKey[], answer: RunAnswer): Pick<DataflowState, 'userOptions' | 'people'> {
  const people = answer.people ? { ...data.people, ...answer.people } : data.people ?? {};
  if (!answer.userOptions) return { userOptions: data.userOptions ?? {}, people };
  const replaced = new Set(answeredKeys.filter((k) => k.startsWith('query:')).map(nameOf));
  const queryOf = (key: string) => key.slice(0, key.indexOf('.'));
  // A stale query's options arrive with a newer run of it; until then its old ones stand.
  const stale = (key: string) => key.includes('.') && Object.hasOwn(data.tables, queryOf(key)) && !replaced.has(queryOf(key));
  const kept = Object.entries(data.userOptions ?? {}).filter(([key]) => !replaced.has(queryOf(key)));
  const fresh = Object.entries(answer.userOptions).filter(([key]) => !stale(key));
  return { userOptions: { ...Object.fromEntries(kept), ...Object.fromEntries(fresh) }, people };
}

/**
 * A run that did not answer. Its queries are answered WITH the error — they
 * are not retried until something they read changes, and a reader waiting on
 * them is released. A write check keeps the last answer it had (one network
 * failure must not grey out every button) and is asked again on the next flush.
 */
function failed(state: CoreState, at: Versions, error: unknown): CoreState {
  const message = error instanceof Error ? error.message : String(error);
  const requested = { ...state.requested }, answeredAt = { ...state.answered }, failedAt = { ...state.failed };
  let errors = state.data.errors;
  for (const [k, v] of Object.entries(at)) {
    if (requested[k] === v) delete requested[k];
    if (versionOf(state, k) !== v) continue;
    if (k.startsWith('query:')) {
      if (errors === state.data.errors) errors = { ...errors };
      errors[nameOf(k)] = message;
      answeredAt[k] = v;
    } else failedAt[k] = v;
  }
  return { ...state, requested, answered: answeredAt, failed: failedAt, data: errors === state.data.errors ? state.data : { ...state.data, errors } };
}

/**
 * A NEW VERSION OF THE DOCUMENT. Every node is new, so every version moves:
 * anything in flight belongs to the document being replaced. The reader's
 * choices are not the document's to reset — a value whose name and type
 * survive keeps what they set — and the incoming rows were computed from the
 * DEFAULTS, so the queries a retained choice feeds start pending.
 */
function replace(state: CoreState, graph: RuntimeGraph, next: DataflowState | undefined, effects: CoreEffect[]): CoreState {
  const tableDecl = (g: RuntimeGraph, name: string) => g.values.find((v) => v.kind === 'table' && v.name === name);
  // A local draft survives only while its declaration (schema and authored rows) is unchanged.
  const local = Object.fromEntries(Object.entries(state.local).filter(([name]) =>
    JSON.stringify(tableDecl(state.graph, name)) === JSON.stringify(tableDecl(graph, name))));
  const before = indexOf(state.graph).scalars, after = indexOf(graph).scalars;
  const kept: Record<string, Scalar> = {};
  for (const [name, type] of after) {
    if (Object.hasOwn(state.data.values, name) && before.get(name) === type) kept[name] = state.data.values[name]!;
  }
  const incoming = { ...graphDefaults(graph), ...(next?.values ?? {}) };
  const declared = new Set(graph.queries.map((q) => q.name));
  const declaredOnly = <T,>(from: Record<string, T>): Record<string, T> => Object.fromEntries(Object.entries(from).filter(([n]) => declared.has(n)));
  // Without state the queries have not been run for us: keep the rows on
  // screen (blanking every chart to announce an edit is the flicker to avoid)
  // and re-run them. The new version's own inline tables are a fact about it, and win.
  const tables = next
    ? { ...graphInlineTables(graph), ...declaredOnly(next.tables ?? {}) }
    : { ...declaredOnly(state.data.tables), ...graphInlineTables(graph) };
  Object.assign(tables, local);

  const clock = state.clock + 1;
  const versions = Object.fromEntries([...Object.keys(state.versions), ...indexOf(graph).nodes].map((k) => [k, clock]));
  const bumped: CoreState = { ...state, graph, clock, versions };
  // The server ran with the defaults and the AUTHORED rows: a retained choice
  // that differs, and every surviving local draft, make their readers stale.
  const diverged = [...Object.keys(kept).filter((n) => !Object.is(kept[n], incoming[n])), ...Object.keys(local)].map(valueKey);
  const answeredAt: Record<NodeKey, number> = {};
  for (const k of indexOf(graph).computed) {
    const leaves = indexOf(graph).leaves.get(k) ?? [];
    if (k.startsWith('query:') ? next && !diverged.some((d) => leaves.includes(d)) : next?.mutationAccess) answeredAt[k] = clock;
  }
  const busy = { ...state.busy };
  for (const w of state.localQueue) {
    effects.push({ type: 'settle', id: w.id, outcome: { ok: false, error: new Error(DOCUMENT_CHANGED) } });
    release(busy, w.name);
  }
  return {
    ...bumped, answered: answeredAt, requested: {}, failed: {}, local, busy, localQueue: [],
    data: {
      values: { ...incoming, ...kept }, tables,
      errors: declaredOnly(next ? next.errors ?? {} : state.data.errors),
      mutationAccess: next?.mutationAccess ?? {},
      userOptions: next?.userOptions ?? {}, people: next?.people ?? {},
    },
  };
}

function release(busy: Record<string, number>, name: string): void {
  const left = (busy[name] ?? 1) - 1;
  if (left > 0) busy[name] = left; else delete busy[name];
}

function write(state: CoreState, event: Extract<CoreEvent, { type: 'write' }>, effects: CoreEffect[]): CoreState {
  const decl = state.graph.mutations.find((m) => m.name === event.name);
  if (!decl) {
    effects.push({ type: 'settle', id: event.id, outcome: { ok: false, error: new Error(`this document declares no <Mutation name="${event.name}">`) } });
    return state;
  }
  const w: LocalWrite = { id: event.id, name: event.name, overrides: event.overrides, row: event.row };
  const busied = { ...state, busy: { ...state.busy, [w.name]: (state.busy[w.name] ?? 0) + 1 } };
  if ('local' in decl.target) return startLocal({ ...busied, localQueue: [...state.localQueue, w] }, effects);
  effects.push({ type: 'write', id: w.id, name: w.name, values: { ...state.data.values, ...w.overrides }, ...(w.row === undefined ? {} : { row: w.row }) });
  return busied;
}

/** Start the next queued local write, reading the state the previous one left. */
function startLocal(state: CoreState, effects: CoreEffect[]): CoreState {
  const [head, ...rest] = state.localQueue;
  if (state.localHead || !head) return state;
  effects.push({ type: 'write', id: head.id, name: head.name, values: { ...state.data.values, ...head.overrides }, row: head.row, localTables: localRows(state) ?? {} });
  return { ...state, localQueue: rest, localHead: { ...head, at: versionOf(state, mutationKey(head.name)) } };
}

function written(
  state: CoreState, event: Extract<CoreEvent, { type: 'written' | 'writeFailed' }>, effects: CoreEffect[],
): CoreState {
  const decl = state.graph.mutations.find((m) => m.name === event.name);
  const busy = { ...state.busy };
  release(busy, event.name);
  const settle = (error?: unknown) => effects.push({ type: 'settle', id: event.id, outcome: error === undefined ? { ok: true } : { ok: false, error } });

  if (state.localHead?.id === event.id) {
    const head = state.localHead;
    let next: CoreState = { ...state, busy, localHead: null };
    if (event.type === 'writeFailed') settle(event.error);
    // Whatever this write read has moved on (a value set, a document
    // replaced): its result describes a state that no longer exists.
    else if (!decl || !('local' in decl.target) || versionOf(state, mutationKey(head.name)) !== head.at) settle(new Error(LOCAL_CHANGED));
    else {
      try {
        next = setValues(commitLocal(next, decl.target.local, event.answer), resetValues(state, decl.reset));
        settle();
      } catch (error) { settle(error); }
    }
    return startLocal(next, effects);
  }

  const target = decl && 'source' in decl.target ? decl.target.source : undefined;
  if (event.type === 'writeFailed') {
    settle(event.error);
    // A permission can disappear between checking it and saving: re-ask, and
    // re-read what the target feeds, while the control keeps the failed draft.
    return bumpSources({ ...state, busy }, target ? [target] : []);
  }
  settle();
  // Cleared first, re-read second, in ONE step: the dependents run once, with
  // the form already empty. The click that writes is the click that redraws.
  const reset = setValues({ ...state, busy }, resetValues(state, decl?.reset));
  return bumpSources(reset, [event.answer.dataset || target || ''].filter(Boolean));
}

/** A successful write clears the form it was typed into (`<Mutation reset>`): those values back to their defaults. */
function resetValues(state: CoreState, names: readonly string[] | undefined): Record<string, Scalar> {
  if (!names?.length) return {};
  const defaults = graphDefaults(state.graph);
  return Object.fromEntries(names.filter((n) => Object.hasOwn(defaults, n)).map((n) => [n, defaults[n]!]));
}

/** Commit a local write's result: typed against the declaration, never trusted for schema. */
function commitLocal(state: CoreState, target: string, answer: MutationAnswer): CoreState {
  const result = answer.local;
  if (!result || result.target !== target) throw new Error('Invalid local mutation result');
  const table = state.graph.values.find((v) => v.kind === 'table' && v.name === target);
  if (!table || table.kind !== 'table') throw new Error('Local table declaration changed');
  const committed: TableResult = { columns: table.columns, rows: checkedLocalRows(result.table.rows, table.columns) };
  return {
    ...bump(state, [valueKey(target)]),
    local: { ...state.local, [target]: committed },
    data: { ...state.data, tables: { ...state.data.tables, [target]: committed } },
  };
}

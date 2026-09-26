/**
 * The runtime core as a MODEL: random interleavings of value changes, runs
 * answering late and out of order (or not at all), dataset writes elsewhere,
 * document replacements and local writes — driven through the pure reducer
 * with a seeded PRNG, against a fake server whose answers are a pure function
 * of what it was asked. Whatever happened on the way, once every effect has
 * resolved the document must show exactly what the server would answer now.
 *
 * The checker is itself checked: the rule this core replaced — apply a result
 * only if it came from the newest run — is replayed as a wrapper, and the
 * checker must find the documents it strands.
 */
import { describe, expect, it } from 'vitest';
import { type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { queriesDependingOn, queriesReadingDatasets, type DataflowState, type Row, type Scalar } from '@/lib/story/dataflow';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import {
  accessSettled, createCore, pendingOf, step,
  type CoreEffect, type CoreEvent, type CoreState, type RunAnswer, type Versions,
} from '../dataflow-core';
import { graphOfDataflow, type RuntimeGraph } from '../runtime-graph';

/** mulberry32: small, seedable, good enough to shuffle a schedule. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T_COLUMNS = [{ name: 'n', type: 'number' as const }];
const T_ROWS: Row[] = [{ n: 0 }];
const SCALARS = ['a', 'b', 'c'] as const;

/** A fresh graph object every call, as a replaced document arrives. */
const graph = (): RuntimeGraph => ({
  values: [
    ...SCALARS.map((name) => ({ kind: 'scalar' as const, name, type: 'number' as const, default: 0 })),
    { kind: 'table', name: 't', rows: T_ROWS, columns: T_COLUMNS },
  ],
  queries: [
    { name: 'qa', reads: { values: ['a'], sources: ['s1', '_members'], queries: [] } },
    { name: 'qb', reads: { values: ['b'], sources: ['_members'], queries: [] } },
    { name: 'qac', reads: { values: ['c'], sources: ['_members'], queries: ['qa'] } },
    { name: 'qt', reads: { values: ['t'], sources: ['_members'], queries: [] } },
  ],
  mutations: [
    { name: 'm1', reads: { values: [], sources: ['s1', '_members'], queries: [] }, target: { source: 's1' } },
    { name: 'add', reads: { values: ['t'], sources: [], queries: [] }, target: { local: 't' } },
    { name: 'inc', reads: { values: [...SCALARS], sources: [], queries: [] }, target: { local: '_signals' }, reset: ['c'] },
  ],
});

/** The fake server: every answer is a pure function of the values, the local rows and the world it ran against. */
function rowsFor(query: string, values: Record<string, Scalar>, s1: number, t: Row[]): Row[] {
  switch (query) {
    case 'qa': return [{ v: `${values.a}|${s1}` }];
    case 'qb': return [{ v: `${values.b}` }];
    case 'qac': return [{ v: `${values.c}|${values.a}|${s1}` }];
    default: return [{ v: t.length }];
  }
}
const accessFor = (s1: number): string | null => (s1 % 2 ? 'Read-only' : null);

type Rule = 'versions' | 'newest-run';

/** Run one seeded schedule; the first invariant it breaks, or null. */
function scenario(seed: number, rule: Rule): string | null {
  const rand = prng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;
  const world = { s1: 0 };
  const serverState = (values: Record<string, Scalar>): DataflowState => ({
    values,
    tables: Object.fromEntries(graph().queries.map((q) => [q.name, { rows: rowsFor(q.name, values, world.s1, T_ROWS), columns: [] }])),
    errors: {},
    ...(rand() < 0.5 ? { mutationAccess: { m1: accessFor(world.s1) } } : {}),
  });
  const defaults = { a: 0, b: 0, c: 0 };
  let state: CoreState = createCore(graph(), rand() < 0.5 ? { state: serverState(defaults) } : {});

  const runs: Array<{ seq: number; at: Versions; answer: RunAnswer }> = [];
  const writes: Array<Extract<CoreEffect, { type: 'write' }>> = [];
  const settled = new Map<number, number>();
  const addIds = new Set<number>();
  let seq = 0, newest = 0, writeIds = 0, adds = 0, failures = true;
  let violation: string | null = null;
  const fail = (why: string) => { violation ??= `seed ${seed}: ${why}`; };

  const apply = (event: CoreEvent) => {
    const prev = state;
    const { state: next, effects } = step(prev, event);
    const notified = effects.some((e) => e.type === 'notify');
    // Snapshot identity: a new data object exactly when readers are told, and nothing else moves it.
    if (notified !== (next.data !== prev.data)) fail(`${event.type}: notify ${notified} but data identity ${next.data !== prev.data ? 'changed' : 'kept'}`);
    if (next === prev && pendingOf(next) !== pendingOf(prev)) fail(`${event.type}: pending identity moved without a change`);
    if (pendingOf(next) !== pendingOf(next)) fail('pending is not memoised');
    // Monotonic: an applied answer never comes from older versions than the one it replaces.
    for (const [k, v] of Object.entries(next.answered)) {
      const before = prev.answered[k];
      if (before !== undefined && v < before) fail(`${k} answered at ${v} after ${before}`);
    }
    state = next;
    for (const effect of effects) {
      if (effect.type === 'run') {
        const t = effect.localTables?.t ?? T_ROWS;
        runs.push({
          seq: ++seq, at: effect.at,
          answer: {
            tables: Object.fromEntries(effect.only.map((q) => [q, { rows: rowsFor(q, effect.values, world.s1, t), columns: [] }])),
            errors: {},
            mutationAccess: { m1: accessFor(world.s1) },
          },
        });
        newest = seq;
      } else if (effect.type === 'write') writes.push(effect);
      else if (effect.type === 'settle') {
        settled.set(effect.id, (settled.get(effect.id) ?? 0) + 1);
        if (effect.outcome.ok && addIds.has(effect.id)) adds++;
      }
    }
  };

  const resolveRun = () => {
    const run = runs.splice(Math.floor(rand() * runs.length), 1)[0]!;
    // The replaced rule: a result that is not from the newest run is dropped whole.
    if (rule === 'newest-run' && run.seq !== newest) return;
    if (failures && rand() < 0.2) apply({ type: 'failed', at: run.at, error: new Error('offline') });
    else apply({ type: 'answered', at: run.at, answer: run.answer });
  };
  const resolveWrite = () => {
    const w = writes.splice(Math.floor(rand() * writes.length), 1)[0]!;
    if (failures && rand() < 0.15) apply({ type: 'writeFailed', id: w.id, name: w.name, error: new Error('refused') });
    else if (w.name === 'm1') {
      world.s1++; // the server wrote, and says which dataset
      apply({ type: 'written', id: w.id, name: w.name, answer: { dataset: 's1' } });
    } else if (w.name === 'add') {
      const rows = w.localTables?.t ?? T_ROWS;
      apply({ type: 'written', id: w.id, name: w.name, answer: { dataset: '', local: { target: 't', affected: 1, table: { columns: T_COLUMNS, rows: [...rows, { n: rows.length }] } } } });
    } else {
      const values = w.values as Record<string, number>;
      apply({ type: 'written', id: w.id, name: w.name, answer: { dataset: '', local: { target: '_signals', affected: 1, table: { columns: [], rows: [{ a: values.a! + 1, b: values.b!, c: values.c! }] } } } });
    }
    apply({ type: 'flush' }); // the shell re-reads after every settled write
  };

  for (let i = 0; i < 80 && !violation; i++) {
    const r = rand();
    if (r < 0.22) {
      apply({ type: 'set', values: { [pick(SCALARS)]: Math.floor(rand() * 4) } });
      if (rand() < 0.6) apply({ type: 'flush' }); // a discrete change runs now; a continuous one waits for the timer
    } else if (r < 0.32) apply({ type: 'flush' });
    else if (r < 0.58) { if (runs.length) resolveRun(); }
    else if (r < 0.64) {
      if (rand() < 0.7) world.s1++; // written elsewhere; `_members` alone changes nothing we model
      apply({ type: 'sources', ids: [rand() < 0.7 ? 's1' : '_members'] });
      apply({ type: 'flush' });
    } else if (r < 0.68) {
      apply(rand() < 0.5 ? { type: 'replace', graph: graph(), state: serverState(defaults) } : { type: 'replace', graph: graph() });
      apply({ type: 'flush' });
    } else if (r < 0.78) {
      const name = pick(['m1', 'add', 'inc'] as const);
      const id = ++writeIds;
      if (name === 'add') addIds.add(id);
      apply({ type: 'write', id, name });
    } else if (r < 0.9) { if (writes.length) resolveWrite(); }
    else if (r < 0.95) {
      apply({ type: 'refresh', ...(rand() < 0.5 ? { queries: [pick(['qa', 'qb', 'qac', 'qt'])] } : {}) });
      apply({ type: 'flush' });
    } else apply({ type: 'touch' });
  }

  // Quiescence: no more failures; everything outstanding answers, the timer fires, and again until nothing is asked.
  failures = false;
  for (let i = 0; i < 1000 && !violation; i++) {
    if (writes.length && (!runs.length || rand() < 0.5)) resolveWrite();
    else if (runs.length) resolveRun();
    else {
      const before = runs.length;
      apply({ type: 'flush' });
      if (runs.length === before) break;
    }
  }
  if (violation) return violation;

  const pending = [...pendingOf(state)];
  if (pending.length) return `seed ${seed}: still pending at rest: ${pending.join(', ')}`;
  if (!accessSettled(state) || state.data.mutationAccess?.m1 !== accessFor(world.s1)) {
    return `seed ${seed}: write check ${JSON.stringify(state.data.mutationAccess)} at rest, expected ${accessFor(world.s1)}`;
  }
  const t = state.data.tables.t?.rows ?? [];
  if (t.length !== T_ROWS.length + adds) return `seed ${seed}: ${t.length} local rows after ${adds} committed adds`;
  for (const q of ['qa', 'qb', 'qac', 'qt']) {
    if (state.data.errors[q]) continue; // answered with the run's failure, and nothing it reads has moved since
    const expected = rowsFor(q, state.data.values, world.s1, t);
    if (JSON.stringify(state.data.tables[q]?.rows) !== JSON.stringify(expected)) {
      return `seed ${seed}: ${q} shows ${JSON.stringify(state.data.tables[q]?.rows)} at rest, the server answers ${JSON.stringify(expected)}`;
    }
  }
  for (let id = 1; id <= writeIds; id++) if (settled.get(id) !== 1) return `seed ${seed}: write ${id} settled ${settled.get(id) ?? 0} times`;
  return null;
}

const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);

describe('the runtime core under random interleavings', () => {
  it('comes to rest current, matching the server, with every write settled once', () => {
    const violations = SEEDS.map((seed) => scenario(seed, 'versions')).filter(Boolean);
    expect(violations).toEqual([]);
  });

  it('the checker catches the rule it replaced: results applied only from the newest run', () => {
    const violations = SEEDS.map((seed) => scenario(seed, 'newest-run')).filter(Boolean);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => /still pending at rest/.test(v!))).toBe(true);
  });
});

/*
 * The graph a parsed document becomes must make stale exactly what the
 * store's text-level rules always re-ran: the queries a scalar feeds, and the
 * readers of a dataset — transitively, through `_signals` and upstream queries.
 */
describe('graphOfDataflow', () => {
  const parsed = parseJsxOrThrow('<Helmet>'
    + '<Value name="region" type="string" />'
    + '<Value name="min_rev" type="number" default={0} />'
    + '<Value name="choice" type="string" default="a" />'
    + '<Query name="sales" source="ref:abc123">{`select * from public.rows where region = $region and revenue >= $min_rev`}</Query>'
    + '<Query name="top">{`select * from sales limit 1`}</Query>'
    + '<Query name="signals">{`select * from _signals`}</Query>'
    + '<Query name="mine">{`select $choice as c`}</Query>'
    + '<Query name="stock" source="ref:zzzzzz">{`select * from public.rows`}</Query>'
    + '<Query name="both">{`select * from top join stock on true`}</Query>'
    + '<Mutation name="vote" source="ref:abc123">{`insert into public.rows (choice) values ($choice)`}</Mutation>'
    + '</Helmet>');
  const { content } = splitHelmet(parsed.nodes as JsxNode[]);
  const flow = { values: content.values, queries: content.queries, mutations: content.mutations };
  const rest = () => createCore(graphOfDataflow(flow), { state: { values: {}, tables: {}, errors: {}, mutationAccess: { vote: null } } });

  it.each(['region', 'min_rev', 'choice'])('setting %s makes stale what queriesDependingOn names', (name) => {
    const { state } = step(rest(), { type: 'set', values: { [name]: 'x' } });
    expect([...pendingOf(state)].sort()).toEqual(queriesDependingOn(flow, [name]).sort());
  });

  it.each(['abc123', 'zzzzzz'])('a write to %s makes stale what queriesReadingDatasets names, and its write checks', (id) => {
    const { state } = step(rest(), { type: 'sources', ids: [id] });
    expect([...pendingOf(state)].sort()).toEqual(queriesReadingDatasets(flow, [id]).sort());
    expect(accessSettled(state)).toBe(id !== 'abc123');
  });

  it('a membership change makes every query and every write check stale', () => {
    const { state } = step(rest(), { type: 'sources', ids: ['_members'] });
    expect([...pendingOf(state)].sort()).toEqual(flow.queries.map((q) => q.name).sort());
    expect(accessSettled(state)).toBe(false);
  });
});

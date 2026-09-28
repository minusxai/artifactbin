/**
 * THE DATA PLAN (docs/phase2-architecture.md §4.2; contract `DataPlan`).
 *
 * Every query of a compiled dataflow is classified by who may see its answer:
 *   shared — the same for every reader, so it goes into the guest snapshot;
 *   viewer — depends on who reads, fetched from the viewer door after paint;
 *   page   — only the page can answer it (`_tz`), never served.
 *
 * A guest snapshot is HTML every reader receives, so a wrong `shared` leaks
 * one reader's data to all of them. The classification therefore admits
 * `shared` only on positive evidence: every dataset the query reads is one the
 * caller says the ANONYMOUS reader is admitted to, every built-in it reads is
 * one known to be the same for everyone, and every query upstream of it is
 * shared too. Anything the plan cannot resolve (an import name with no ref, a
 * dataset with no access fact, a Postgres query with no source, a built-in it
 * does not know, an upstream query it has not seen) is `viewer`.
 *
 * Scope is the most specific of a query's own reads and its upstream queries'
 * scopes, `page` over `viewer` over `shared`: a query that reads the reader's
 * zone cannot be served to anyone, whoever it also names.
 *
 * Pure and deterministic: no I/O, no clock, output order follows the flow.
 */
import type { CompiledDataflow, CompiledQuery, CompiledReads } from '@/lib/story/compiled-dataflow';
import { importRef, mutationTargetRef } from '@/lib/story/compiled-flow';
import { placeDataflow } from '@/lib/story/placement';
import type { DataPlan, DatasetAccessFacts, PlannedMutation, PlannedQuery, PlannedValue, QueryScope } from './contract';

/** Built-ins whose value is the same for every reader of one version (§4.2: `_members` is covered by the snapshot's marks, `_now` by its age bound). */
const SHARED_BUILTINS: ReadonlySet<string> = new Set(['_members', '_now']);
/** The built-in only the page knows: the reader's own time zone (served-results.server `servable`). */
const PAGE_BUILTIN = '_tz';
/** `_me` (the one-row table), `_me.id`, `_me.role`: the answer names the reader. */
const isViewerBuiltin = (name: string): boolean => name === '_me' || name.startsWith('_me.');

const RANK: Record<QueryScope, number> = { shared: 0, viewer: 1, page: 2 };

/** One reason a query cannot be shared, and the scope it forces. */
interface Reason { scope: Exclude<QueryScope, 'shared'>; because: string }

function ownReasons(flow: CompiledDataflow, q: CompiledQuery, facts: DatasetAccessFacts): Reason[] {
  const reasons: Reason[] = [];
  const admitted = (ref: string) => facts.datasets[ref]?.anonymousRead === true;
  for (const builtin of q.reads.builtins) {
    if (builtin === PAGE_BUILTIN) reasons.push({ scope: 'page', because: `reads ${builtin}` });
    else if (isViewerBuiltin(builtin)) reasons.push({ scope: 'viewer', because: `reads ${builtin}` });
    else if (!SHARED_BUILTINS.has(builtin)) reasons.push({ scope: 'viewer', because: `reads ${builtin}, which the plan does not know to be the same for every reader` });
  }
  for (const name of q.reads.imports) {
    const ref = importRef(flow, name);
    if (ref === undefined) reasons.push({ scope: 'viewer', because: `import ${name} names no dataset` });
    else if (!admitted(ref)) reasons.push({ scope: 'viewer', because: `dataset ${ref} (import ${name}) is not admitted to the anonymous reader through this document` });
  }
  if (q.engine === 'postgres' && !q.source) reasons.push({ scope: 'viewer', because: 'a Postgres query with no source' });
  if (q.source && !admitted(q.source)) reasons.push({ scope: 'viewer', because: `dataset ${q.source} (Postgres source) is not admitted to the anonymous reader through this document` });
  for (const name of q.reads.values) {
    const value = flow.values.find((v) => v.name === name);
    if (!value) reasons.push({ scope: 'viewer', because: `reads ${name}, which is not declared` });
    else if (value.type === 'user' || value.source !== undefined || (value.columns ?? []).some((c) => c.type === 'user')) {
      reasons.push({ scope: 'viewer', because: `reads ${name}, which names people (person cards are per viewer)` });
    }
  }
  for (const column of q.columns) if (column.type === 'user') reasons.push({ scope: 'viewer', because: `column ${column.name} names people (person cards are per viewer)` });
  return reasons;
}

function classify(flow: CompiledDataflow, facts: DatasetAccessFacts): PlannedQuery[] {
  const planned = new Map<string, PlannedQuery>();
  // Run order puts every upstream query first (CompiledDataflow.queries).
  for (const q of flow.queries) {
    const reasons = ownReasons(flow, q, facts);
    for (const upstream of q.reads.queries) {
      const up = planned.get(upstream);
      if (!up) reasons.push({ scope: 'viewer', because: `reads query ${upstream}, which the plan has not classified` });
      else if (up.scope !== 'shared') reasons.push({ scope: up.scope, because: `reads query ${upstream} (${up.because})` });
    }
    const scope = reasons.reduce<QueryScope>((s, r) => (RANK[r.scope] > RANK[s] ? r.scope : s), 'shared');
    const because = scope === 'shared'
      ? 'reads only data the anonymous reader is admitted to'
      : reasons.filter((r) => r.scope === scope).map((r) => r.because).join('; ');
    planned.set(q.name, { name: q.name, scope, reads: copyReads(q.reads), because });
  }
  return flow.queries.map((q) => planned.get(q.name)!);
}

const copyReads = (r: CompiledReads): CompiledReads => ({ imports: [...r.imports], queries: [...r.queries], values: [...r.values], builtins: [...r.builtins] });

/** `planOf` (contract `PlanOf`). */
export function planOf(flow: CompiledDataflow, facts: DatasetAccessFacts): DataPlan {
  const queries = classify(flow, facts);
  const sharedNames = new Set(queries.filter((q) => q.scope === 'shared').map((q) => q.name));
  const shared = flow.queries.filter((q) => sharedNames.has(q.name));

  const datasets = new Set<string>();
  for (const q of shared) {
    for (const name of q.reads.imports) {
      const ref = importRef(flow, name);
      if (ref !== undefined) datasets.add(ref);
    }
    if (q.source) datasets.add(q.source);
  }

  const keyed = new Set(shared.flatMap((q) => q.reads.values));
  const values: PlannedValue[] = flow.values
    .filter((v) => v.kind === 'scalar')
    .map((v) => ({ name: v.name, default: v.default, keysSnapshot: keyed.has(v.name) }));

  // No reader holds anything at compile: a local write the page can compute is
  // optimistic, a dataset write waits for the server (lib/story/placement).
  const placement = placeDataflow(flow, []);
  const mutations: PlannedMutation[] = flow.mutations.map((m) => ({
    name: m.name,
    dataset: mutationTargetRef(flow, m),
    placement: placement.mutations[m.name] === 'server' ? 'server' : 'optimistic',
  }));

  return {
    queries,
    values,
    mutations,
    datasets: [...datasets].sort(),
    readsMembers: shared.some((q) => q.reads.builtins.includes('_members')),
    postgres: shared.some((q) => q.engine === 'postgres'),
  };
}

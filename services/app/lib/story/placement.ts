/**
 * WHERE EACH NODE RUNS — in the reader's browser, on SQLite over data the
 * page holds, or on the server exactly as before. Decided per node from the
 * compiled graph (lib/story/compiled-dataflow `reads`) and one serve-time fact
 * the island carries: the imports THIS reader may hold in full
 * (StoryIslandDataflow.hold, computed by lib/artifacts holdableImportsFor).
 *
 * A query runs in the browser iff it runs on SQLite, every import it reads is
 * held, every query it reads runs in the browser, and it does not read the
 * membership — the page never holds member rows, which would expose more than
 * the queries project from them. Everything else — a connected Postgres query,
 * anything downstream of one, a dataset the reader may not hold whole — runs
 * on the server.
 *
 * Writes: a local-table write is computed in the page unless it needs the
 * server's knowledge (an import it does not hold, the membership, or a person
 * column, whose ids the server validates). A dataset write is OPTIMISTIC when
 * its target and everything it reads are held: applied to the held copy for an
 * instant result, then run on the server, which decides.
 *
 * Absent facts (the editor's canvas, a capture, a framed relay) place
 * everything on the server. Pure and browser-safe.
 */
import type { CompiledDataflow, CompiledReads } from './compiled-dataflow';

export type NodePlacement = 'browser' | 'server';
export type WritePlacement = 'browser' | 'optimistic' | 'server';

export interface DataflowPlacement {
  queries: Record<string, NodePlacement>;
  mutations: Record<string, WritePlacement>;
}

/** The most a reader may hold of one import: past either cap its queries run on the server. */
export const HOLD_MAX_ROWS = 50_000;
export const HOLD_MAX_BYTES = 5 * 1024 * 1024;

export function placeDataflow(flow: CompiledDataflow, hold: readonly string[] | undefined): DataflowPlacement {
  const held = new Set(hold ?? []);
  const readsHeld = (reads: CompiledReads) => !!hold && reads.imports.every((i) => held.has(i)) && !reads.builtins.includes('_members');
  const queries: Record<string, NodePlacement> = {};
  // Run order puts every upstream query first.
  for (const q of flow.queries) {
    queries[q.name] = q.engine === 'sqlite' && readsHeld(q.reads) && q.reads.queries.every((u) => queries[u] === 'browser') ? 'browser' : 'server';
  }
  const mutations: Record<string, WritePlacement> = {};
  for (const m of flow.mutations) {
    if ('local' in m.target) {
      const target = m.target.local;
      const table = flow.values.find((v) => v.kind === 'table' && v.name === target);
      const people = (table?.columns ?? []).some((c) => c.type === 'user');
      mutations[m.name] = readsHeld(m.reads) && !people ? 'browser' : 'server';
    } else {
      mutations[m.name] = readsHeld(m.reads) && held.has(m.target.import) ? 'optimistic' : 'server';
    }
  }
  return { queries, mutations };
}

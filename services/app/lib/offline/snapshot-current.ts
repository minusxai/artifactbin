/** A downloaded answer is valid only for the query text it was taken over. */
import { EMPTY_DATAFLOW } from '@/lib/dataflow/dataflow';
import type { Dataflow, DataflowState, QueryDecl } from '@/lib/dataflow';
import { declarationsOf } from '@/lib/document/helmet';
import { OFFLINE_QUERY_REASON, type ArtifactFile } from './file-format';

const sameQuery = (a: QueryDecl | undefined, b: QueryDecl) => !!a && a.sql === b.sql && (a.source ?? null) === (b.source ?? null);

export function unranQueries(flow: Dataflow, ran: Dataflow): Set<string> {
  const before = new Map(ran.queries.map((query) => [query.name, query]));
  return new Set(flow.queries.filter((query) => !sameQuery(before.get(query.name), query)).map((query) => query.name));
}

export const ranFlowOf = (file: ArtifactFile): Dataflow => declarationsOf(file.base.source) ?? EMPTY_DATAFLOW;

export const unranQueriesOf = (file: ArtifactFile): Set<string> =>
  unranQueries(declarationsOf(file.source) ?? EMPTY_DATAFLOW, ranFlowOf(file));

export function snapshotStateFor(file: ArtifactFile): DataflowState {
  const state = file.snapshot.state;
  if (!file.island.dataflow?.flow) return state;
  const unran = unranQueriesOf(file);
  if (!unran.size) return state;
  const tables = Object.fromEntries(Object.entries(state.tables).filter(([name]) => !unran.has(name)));
  const errors = { ...state.errors };
  for (const name of unran) errors[name] = OFFLINE_QUERY_REASON;
  return { ...state, tables, errors };
}

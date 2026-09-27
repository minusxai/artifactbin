/**
 * THE FIRST RESULTS, IN THE HTML.
 *
 * A data document used to arrive with its declarations and no rows: the page
 * painted skeletons, then asked for its rows — the query route, or its own
 * SQLite engine after downloading the wasm and the dataset. The numbers were
 * never in the first byte.
 *
 * At SERVE time this runs the queries the page would ask for first — every
 * query at the values the request starts from (the declared defaults and the
 * URL's `$` values) — and hands their answers to the per-viewer overlay
 * (StoryIslandDataflow.results). The server render draws them and the
 * reader's store starts from them, so hydration matches by construction and
 * nothing is asked until an input changes.
 *
 * PARITY WITH THE QUERY ROUTE (app/a/[id]/query) is the whole rule:
 *  - the same run, `dataflowForRow`, so the same engine, caches
 *    (`dataset_result_cache`), row caps and timeouts;
 *  - the same admission as the door the page queries through — the POST
 *    door's session viewer for the app page, the anonymous GET door for the
 *    standalone document — rechecked after the run, like the route does;
 *  - the same viewer inside the run, so `$_me` reads and read grants answer
 *    exactly what the page's first request would have been answered.
 * A refusal the route answers with a 404 serves nothing; a refusal it answers
 * per query (a dataset this reader may not read) is served as that answer.
 *
 * What it will NOT answer: a query that reads the reader's time zone (`$_tz`),
 * or anything downstream of one — the page sends its own zone, which the
 * server does not know. Those stay the page's first run, as before.
 *
 * THE BUDGET: the HTML never waits on a slow query. Whatever has not answered
 * within SERVED_RESULTS_BUDGET_MS is left to the page, exactly as today. The
 * late run is DETACHED, not aborted: it keeps filling the result cache it
 * leased, so the page's own request that follows is a hit or a short wait
 * rather than a cold start.
 */
import { canReadArtifact, dataflowForRow, getArtifactById, type ArtifactRow, type RoleActor, type Viewer } from '@/lib/artifacts';
import { DatasetError } from '@/lib/datasets/errors';
import type { CompiledDataflow } from './compiled-dataflow';
import { selectQueries } from './compiled-flow';
import { readUrlValues } from './url-values';
import type { ServedResults } from '@/lib/story-runtime/contract';

/**
 * How long a page's HTML may wait for its first results. Measured on the
 * page-speed dashboard fixture (three queries over a 144-row stored dataset):
 * the run answers in single-digit milliseconds warm and tens cold, and a
 * connected database that answers from `dataset_result_cache` is a lookup.
 * Past this, a query's rows cost the reader more in TTFB than they save.
 */
export const SERVED_RESULTS_BUDGET_MS = 250;

/** The built-in the server cannot supply for the reader: their own zone. */
const READER_ZONE = '_tz';

/** The queries whose answers do not depend on anything only the page knows. */
function servable(flow: CompiledDataflow): string[] {
  return flow.queries
    .filter((q) => !selectQueries(flow, { only: [q.name] }).some((upstream) => upstream.reads.builtins.includes(READER_ZONE)))
    .map((q) => q.name);
}

export interface ServedResultsRequest {
  /**
   * The viewer the page's query door admits: the session's for the app page
   * (the POST door), null for the standalone document (the anonymous GET door).
   */
  admit: Viewer;
  /** Who the run is for, as that door passes it (null: anonymous). */
  viewer: RoleActor | null;
  /** The page's query string: the reader's `$` values. */
  search: string;
  /** Tests only; the product always runs under SERVED_RESULTS_BUDGET_MS. */
  budgetMs?: number;
}

const pick = <T>(from: Record<string, T> | undefined, names: ReadonlySet<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(from ?? {}).filter(([name]) => names.has(name)));

/** The run, as the query route answers it; null wherever the route would answer no rows at all. */
async function run(row: ArtifactRow, flow: CompiledDataflow, request: ServedResultsRequest): Promise<ServedResults | null> {
  const names = servable(flow);
  if (!names.length) return null;
  if (!(await canReadArtifact(row, request.admit))) return null;
  // The route's own recheck: the same version, still readable by this viewer, after every wait.
  const authorize = async () => {
    const current = await getArtifactById(row.id);
    if (!current || current.edit_id !== row.edit_id || !(await canReadArtifact(current, request.admit))) throw new DatasetError('Document is unavailable', 404);
  };
  const ran = await dataflowForRow(row, { values: readUrlValues(request.search, flow), only: names, viewer: request.viewer, authorize });
  await authorize();
  if (!ran) return null;
  const answered = new Set(names);
  const { state } = ran;
  return {
    tables: pick(state.tables, answered),
    errors: pick(state.errors, answered),
    ...(ran.flow.mutations.length ? { mutationAccess: state.mutationAccess ?? {} } : {}),
    ...(state.userOptions ? { userOptions: state.userOptions, people: state.people ?? {} } : {}),
  };
}

/**
 * This request's first results for `row` (the head, never an archived
 * version), or null: nothing servable, a door that would refuse, a failure,
 * or no answer within the budget.
 */
export async function servedResultsFor(row: ArtifactRow, flow: CompiledDataflow, request: ServedResultsRequest): Promise<ServedResults | null> {
  const answer = run(row, flow, request).catch(() => null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), request.budgetMs ?? SERVED_RESULTS_BUDGET_MS); });
  try {
    return await Promise.race([answer, late]);
  } finally {
    clearTimeout(timer);
  }
}

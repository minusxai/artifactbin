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
 *    door's session viewer for the app page — rechecked after the run, like
 *    the route does. (The standalone document, /raw, is not served results
 *    yet: its live stream cannot pick up from them — lib/story-runtime/live-entry
 *    reloads on a data frame that arrives before its runtime.)
 *  - the same viewer inside the run, so `$_me` reads and read grants answer
 *    exactly what the page's first request would have been answered.
 * A refusal the route answers with a 404 serves nothing; a refusal it answers
 * per query (a dataset this reader may not read) is served as that answer.
 *
 * What it will NOT answer: a query that reads the reader's time zone (`$_tz`),
 * or anything downstream of one — the page sends its own zone, which the
 * server does not know. Those stay the page's first run, as before.
 *
 * THE LIVE STREAM PICKS UP FROM HERE. A page used to ask for its rows at about
 * the moment it opened its live stream (app/a/[id]/events), so a write to a
 * dataset landed on one side or the other. Served rows are older than the
 * stream by a download and a hydration, so they carry `since`: a mark of each
 * dataset they were computed from, taken BEFORE the run. The page opens its
 * stream with it, and the stream sends the ordinary `data` frame for every
 * dataset whose mark has moved since — so a write, a new grant or a new policy
 * in that gap reaches the page exactly as one a second later would.
 *
 * THE BUDGET: the HTML never waits on a slow query. Whatever has not answered
 * within SERVED_RESULTS_BUDGET_MS is left to the page. The
 * late run is DETACHED, not aborted: it keeps filling the result cache it
 * leased, so the page's own request that follows is a hit or a short wait
 * rather than a cold start.
 */
import { createHash } from 'node:crypto';
import { type ArtifactRow, canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { dataflowForRow } from '@/lib/document-data';
import type { RoleActor, Viewer } from '@/lib/accounts';
import { getDb } from '@/lib/platform/db';
import { DatasetError } from '@/lib/datasets/errors';
import { type CompiledDataflow, dataRefs, selectQueries, readUrlValues } from '@/lib/dataflow';
import type { ServedResults } from '@/lib/story-runtime/contract';

/**
 * How long a page's HTML may wait for its first results. Measured on the
 * page-speed dashboard fixture (three queries over a 144-row stored dataset,
 * dev server, worker-pool SQLite): the same run through `POST /a/<id>/query`
 * answers in 8 ms p50 / 10–12 ms p95 warm, and ~160 ms on the first request
 * after a restart (cold engine and dataset). The budget covers that cold run
 * and stays far below what the page's own path costs the reader (the query
 * round trip after hydration, or the SQLite wasm and the dataset download);
 * a run that needs longer is left to the page, as before.
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

interface ServedResultsRequest {
  /** The viewer the page's query door admits: the session's for the app page (the POST door); null is the anonymous door. */
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

/*
 * A DATASET'S MARK: everything about its row that changes when what a reader
 * may see of it does — its rows (version, edit id, stored meta), who may read
 * it (visibility, link role, shares, policy) and whether it exists. Opaque and
 * short; a spurious difference costs one re-run, never a missed one.
 */
const MARK_SQL = `SELECT id, version, edit_id, visibility, link_role, sharing_revision, policy_revision, deleted_at IS NULL AS live, md5(meta::text) AS meta
  FROM artifacts WHERE id = ANY($1::text[])`;

/** The current mark of each of these datasets; a missing one has none. Also the guest snapshots' freshness rule (lib/publish/prepared/snapshots.server). */
export async function marksOf(ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const rows = (await (await getDb()).query<{ id: string }>(MARK_SQL, [[...ids]])).rows;
  return new Map(rows.map((r) => [r.id, createHash('sha256').update(JSON.stringify(r)).digest('base64url').slice(0, 12)]));
}

const TOKEN_PART = /^([A-Za-z0-9]+)\.([A-Za-z0-9_-]{12})$/;

/** `id.mark~id.mark` — what a page hands its live stream (`?since=`). */
export const tokenOf = (marks: Map<string, string>): string => [...marks].sort(([a], [b]) => a.localeCompare(b)).map(([id, mark]) => `${id}.${mark}`).join('~');

/**
 * The datasets among `followed` whose mark has moved since `since` (a token a
 * served page carried). Only ids the token names are judged: a dataset the
 * page was not served from is not its to report, and a token that does not
 * parse names nothing.
 */
export async function changedSince(since: string | null, followed: Iterable<string>): Promise<string[]> {
  if (!since || since.length > 4096) return [];
  const then = new Map<string, string>();
  for (const part of since.split('~')) {
    const m = TOKEN_PART.exec(part);
    if (m) then.set(m[1]!, m[2]!);
  }
  const judged = [...new Set(followed)].filter((id) => then.has(id));
  if (!judged.length) return [];
  const now = await marksOf(judged);
  return judged.filter((id) => now.get(id) !== then.get(id));
}

/** The run, as the query route answers it; null wherever the route would answer no rows at all. */
async function run(row: ArtifactRow, flow: CompiledDataflow, request: ServedResultsRequest): Promise<ServedResults | null> {
  const names = servable(flow);
  if (!names.length) return null;
  if (!(await canReadArtifact(row, request.admit))) return null;
  // Marked BEFORE the run: a change after this is reported to the page's stream even if the run saw it.
  const marks = await marksOf(dataRefs(flow, flow.values.flatMap((v) => (v.source ? [v.source] : []))));
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
    ...(marks.size ? { since: tokenOf(marks) } : {}),
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

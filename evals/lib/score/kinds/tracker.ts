/**
 * The `tracker` kind — the first task that grades the product's INTERACTIVE
 * half.
 *
 * Every other task asks whether the agent could BUILD something a reader looks
 * at. This one asks whether it built something a reader can USE: a dataset
 * published `access: readwrite`, a dataset-backed `<Mutation>`, a row-keyed
 * `<For keyBy>` / `<DataTable rowKey>` carrying a `<Button run="$name">`, and
 * counts that re-run after a write.
 *
 * Three of its four checks are read off the document; the fourth cannot be.
 * `mutation_works` is the one question the markup cannot answer — a button
 * that looks right and a `<Mutation>` that dry-ran at publish still say
 * nothing about whether a click CHANGES A ROW — so the DRIVER runs the write
 * itself and reads the dataset back.
 *
 * WHICH DOOR THE PROBE USES, and why it is not the one a first reading
 * suggests: `POST /api/artifacts/<id>/mutate` (the owner's door) calls
 * `runDocumentMutation(row, name, values, undefined, …)` with the row snapshot
 * hard-coded to `undefined`, so a `$_row` mutation — exactly the shape
 * `uses_row_template` demands — comes back `invalid_row` there, every time.
 * The READER's door `POST /a/<id>/mutate` takes `{mutation, values, row}` and
 * is the door the row button itself uses, so it is the one that can answer the
 * question honestly.
 *
 * WHAT IS THE AGENT'S ANSWER AND WHAT IS OUR INSTRUMENT: a refusal from the
 * write door (`dataset_read_only`, `policy_denied`, `unknown_mutation`) is the
 * agent's — the tracker does not work — and answers `false`. A read that
 * throws, or a 5xx, is ours: it raises `DriverFailure`, which `runChecks`
 * turns into unanswered checks that stop gating (`checks_ok`), rather than
 * reporting a tracker that was never asked. Either way the `mutation_probe`
 * row says what was tried, so a reader can see WHY it failed without the
 * transcript.
 */
import type { JsxElement, JsxNode } from '@/lib/jsx';
import type { Dataflow, DataflowState, MutationDecl, Row, Scalar } from '@/lib/story/dataflow';
import { DriverFailure, type CheckContext, type TaskScorer } from './contract';

/**
 * Declared apart from the scorer for the reason `publish.ts` gives:
 * `contracts.ts` builds its check enum from these names.
 *
 * `no_iframe` is here rather than among the common checks because at the time
 * of writing nothing else answers it; it is a task-specific check that a
 * common one may later replace (see REPORT.md).
 */
export const TRACKER_CHECKS = ['uses_row_template', 'declares_mutation', 'mutation_works', 'no_iframe'] as const;

// ---------------------------------------------------------------- the island

/** `lib/story-runtime/contract.ts` — the JSON island the served document carries. */
const ISLAND_ID = 'mx-story-data';

/**
 * The half of `StoryIslandData` this kind reads.
 *
 * `nodes` is `splitHelmet(parseJsx(source)).body` — the published markup's own
 * AST, which is why the three static checks ask the island rather than
 * re-fetching the stored source: it needs no second HTTP call and no document
 * id, so an instrument failure cannot silently ungate them.
 */
export interface TrackerIsland {
  nodes: JsxNode[];
  /** `/a/<id>/mutate`, present exactly when the document declares a `<Mutation>` (raw route). */
  mutateUrl?: string;
  dataflow?: { flow?: Dataflow; state?: DataflowState };
}

export function islandOf(html: string): TrackerIsland | null {
  const m = new RegExp(`<script[^>]*id="${ISLAND_ID}"[^>]*>([\\s\\S]*?)</script>`).exec(html);
  if (!m) return null;
  try {
    const island = JSON.parse(m[1]) as TrackerIsland;
    return { ...island, nodes: Array.isArray(island.nodes) ? island.nodes : [] };
  } catch {
    return null; // a malformed island is no evidence, not a crash
  }
}

const elementsIn = (nodes: JsxNode[]): JsxElement[] =>
  nodes.flatMap((node) => (node.type === 'element' ? [node, ...elementsIn(node.children)] : []));

const staticAttr = (el: JsxElement, name: string): unknown => {
  const value = el.attributes.find((a) => a.name === name)?.value;
  return value?.static ? value.json : undefined;
};

const namedKey = (el: JsxElement, name: string): boolean => {
  const key = staticAttr(el, name);
  return typeof key === 'string' && key.length > 0;
};

/**
 * `uses_row_template` — the document repeats a row TEMPLATE with a key, which
 * is what a row action requires (`lib/story/row-scope`: "For actions require
 * keyBy=", "editable DataTable requires rowKey=").
 */
export function usesRowTemplate(island: TrackerIsland): boolean {
  return elementsIn(island.nodes).some(
    (el) => (el.tag === 'For' && namedKey(el, 'keyBy')) || (el.tag === 'DataTable' && namedKey(el, 'rowKey')),
  );
}

/** `no_iframe` — nothing on the page is somebody else's document. */
export function noIframe(island: TrackerIsland): boolean {
  return !elementsIn(island.nodes).some((el) => el.tag.toLowerCase() === 'iframe');
}

/** Every `<Mutation>` the document declares, whatever its scope. */
const mutationsOf = (island: TrackerIsland): MutationDecl[] => island.dataflow?.flow?.mutations ?? [];

/** The ones that write a DATASET (`source="ref:<id>"`), never a local table or `_signals`. */
export const datasetMutations = (island: TrackerIsland): MutationDecl[] =>
  mutationsOf(island).filter((m) => m.scope !== 'local' && typeof m.target === 'string' && m.target.length > 0);

/**
 * `declares_mutation` — at least one mutation is dataset-backed. A local one
 * edits the reader's own copy and is gone on reload, which is not a shared
 * tracker.
 */
export const declaresMutation = (island: TrackerIsland): boolean => datasetMutations(island).length > 0;

// ---------------------------------------------------------------- the probe's pure halves

/** A value that reads as "this task is finished". */
const DONE_RE = /^(done|complete|completed|finished|closed|resolved|shipped|true|1)$/i;
/** A mutation NAME (or SQL) that means "mark it done". */
const COMPLETES_RE = /complete|done|finish|close|resolve|mark/i;
/** The bound row snapshot and the edited cell, which are not ordinary `$name` parameters. */
const ROW_PARAM = '_row';
const VALUE_PARAM = '_value';

/**
 * The agent's "complete"/"done" mutation, chosen from what it declared.
 *
 * An UPDATE, because that is the statement that can move a row's status —
 * the task also asks for an INSERT ("add a task") and running that would prove
 * the wrong thing. Named first, then any update at all: an agent that called
 * it `finish_task` or `toggle` still built the thing being graded.
 */
export function completionMutation(mutations: readonly MutationDecl[]): MutationDecl | null {
  const updates = mutations.filter((m) => m.scope !== 'local' && /^\s*update\b/i.test(m.sql));
  return updates.find((m) => COMPLETES_RE.test(m.name)) ?? updates.find((m) => DONE_RE.test(doneLiteral(m.sql) ?? '')) ?? updates[0] ?? null;
}

/** The literal a `set … = 'done'` statement writes, when it writes one. */
const doneLiteral = (sql: string): string | null => /=\s*'([^']+)'/.exec(sql)?.[1] ?? null;

const isRowMutation = (sql: string): boolean => new RegExp(`\\$${ROW_PARAM}\\b`).test(sql);
const isCellMutation = (sql: string): boolean => new RegExp(`\\$${VALUE_PARAM}\\b`).test(sql);

const scalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));

/**
 * DID A TASK GET MARKED DONE — asked of the dataset's rows, before and after.
 *
 * Rows are matched by their id-like column, so the answer is about ONE row
 * moving rather than about the table's shape: an INSERT (the task's other
 * mutation) leaves every existing row alone and answers false, and a row that
 * moved the other way — done → todo — is not a completion either.
 */
export function rowMarkedDone(before: readonly Row[], after: readonly Row[]): { ok: boolean; note: string } {
  const key = idColumn(before);
  if (!key) return { ok: false, note: 'the dataset rows carry no unique id column to compare by' };
  const was = new Map(before.map((row) => [String(row[key]), row]));
  for (const row of after) {
    const previous = was.get(String(row[key]));
    if (!previous) continue; // a new row is an insert, not a completion
    for (const [column, value] of Object.entries(row)) {
      if (column === key || value === previous[column]) continue;
      if (DONE_RE.test(String(value))) {
        return { ok: true, note: `${key}=${String(row[key])} ${column} ${JSON.stringify(previous[column])}→${JSON.stringify(value)}` };
      }
    }
  }
  return { ok: false, note: `no row changed to a done value (${after.length} rows read back, unchanged)` };
}

/** The column whose values identify a row: `id` when there is one, else the first unique column. */
function idColumn(rows: readonly Row[]): string | null {
  if (!rows.length) return null;
  const columns = Object.keys(rows[0]);
  const unique = (c: string) => new Set(rows.map((r) => String(r[c]))).size === rows.length;
  return columns.find((c) => c.toLowerCase() === 'id' && unique(c)) ?? columns.find(unique) ?? null;
}

/**
 * Bind a mutation's declared `$name` parameters from a row.
 *
 * Only VALUES ever travel — the SQL and the target come from the stored
 * document — so this is a name-matching exercise: the column itself, the name
 * with a `task_`/`row_`/`new_`/`p_` prefix removed, or the column a suffix
 * names (`task_id` → `id`). A status-shaped parameter with no column behind it
 * is bound to the literal the statement itself writes, which is how a
 * `set status = $status` mutation is completed rather than skipped.
 */
export function bindParams(decl: MutationDecl, row: Row | null): Record<string, Scalar> | null {
  const out: Record<string, Scalar> = {};
  for (const param of decl.params) {
    if (param === ROW_PARAM) continue;
    if (param === VALUE_PARAM) {
      out[param] = doneLiteral(decl.sql) ?? 'done';
      continue;
    }
    const value = row ? columnFor(param, row) : undefined;
    if (value !== undefined) out[param] = value;
    else if (/status|state|stage/i.test(param)) out[param] = doneLiteral(decl.sql) ?? 'done';
    else return null;
  }
  return out;
}

const PREFIX_RE = /^(task|row|new|p|the)_/;

function columnFor(param: string, row: Row): Scalar | undefined {
  const names = Object.keys(row);
  const bare = param.replace(PREFIX_RE, '');
  const hit =
    names.find((n) => n === param) ??
    names.find((n) => n === bare) ??
    names.find((n) => n.toLowerCase() === bare.toLowerCase()) ??
    names.find((n) => param.toLowerCase().endsWith(`_${n.toLowerCase()}`));
  const value = hit === undefined ? undefined : row[hit];
  return value !== undefined && scalar(value) ? value : undefined;
}

/** Rows the document actually RENDERED, which is where a `$_row` snapshot has to come from. */
export function renderedRows(island: TrackerIsland): Row[] {
  const tables = island.dataflow?.state?.tables ?? {};
  return Object.values(tables).flatMap((table) => table.rows ?? []);
}

/**
 * `/a/<id>/mutate` → `<id>`. The island names the document's own write door
 * (raw route, `mutatePath`), which is the one place the SERVED document says
 * which artifact it is.
 */
export const documentIdOf = (island: TrackerIsland): string | null =>
  /^\/a\/([A-Za-z0-9]{6,12})\/mutate$/.exec(island.mutateUrl ?? '')?.[1] ?? null;

// ---------------------------------------------------------------- the probe

/** How many rows the probe will offer the door before giving up. A tracker's table is small. */
const MAX_ATTEMPTS = 6;

interface Probe {
  ok: boolean;
  /** Recorded as `mutation_probe` — what was tried, and what came back. */
  note: string;
}

export async function probeMutation(ctx: CheckContext, island: TrackerIsland): Promise<Probe> {
  const declared = datasetMutations(island);
  if (!declared.length) {
    const local = mutationsOf(island).length;
    return { ok: false, note: local ? `${local} <Mutation> declared, all local — nothing writes a dataset` : 'the document declares no <Mutation>' };
  }
  const decl = completionMutation(declared);
  if (!decl) return { ok: false, note: `no UPDATE among the declared mutations (${declared.map((m) => m.name).join(', ')}) — nothing marks a task done` };

  // `scoredId` is the artifact the run is scored on; the island's own write door is
  // the answer whenever the driver was not told (see REPORT.md, contract request).
  const docId = documentIdOf(island) ?? ctx.scoredId ?? ctx.startId;
  const before = await readDatasetRows(ctx, decl.target);
  const attempts = attemptsFor(decl, island, before);
  if (!attempts.length) {
    return { ok: false, note: `"${decl.name}" takes ${decl.params.join(', ')}, and nothing in the document's own rows binds them` };
  }

  const tried: string[] = [];
  for (const attempt of attempts.slice(0, MAX_ATTEMPTS)) {
    const sent = await postMutation(ctx, docId, {
      mutation: decl.name,
      values: attempt.values,
      ...(attempt.row ? { row: attempt.row } : {}),
    });
    tried.push(`${decl.name}(${JSON.stringify(attempt.values)}${attempt.row ? `, row ${JSON.stringify(attempt.row)}` : ''}) → ${sent.status}${sent.error ? ` ${sent.error}` : ''}`);
    if (sent.status === 200) {
      const after = await readDatasetRows(ctx, decl.target);
      const changed = rowMarkedDone(before, after);
      return { ok: changed.ok, note: `${tried[tried.length - 1]}; ${changed.note}` };
    }
    // A row the schema refuses is this CANDIDATE's failure — try the next one. Anything
    // else is the document's answer and retrying it with another row would only repeat it.
    if (!RETRYABLE.has(sent.error ?? '')) break;
  }
  return { ok: false, note: tried.join(' | ') };
}

/** Refusals about the ROW we chose, not about the document — worth another candidate. */
const RETRYABLE = new Set(['invalid_row', 'row_changed', 'row_not_unique']);

interface Attempt {
  values: Record<string, Scalar>;
  row?: Row;
}

/**
 * What to send, in the order worth trying.
 *
 * A `$_row` mutation is bound from the rows the DOCUMENT rendered (the island's
 * query results), because `runDocumentMutation` compares the snapshot field by
 * field against the declared table's result columns — a dataset row, which
 * carries the dataset's columns instead, would be refused as `invalid_row`.
 * Unfinished rows come first: completing an already-done row changes nothing
 * and would read as a tracker that does not work.
 */
function attemptsFor(decl: MutationDecl, island: TrackerIsland, dataset: readonly Row[]): Attempt[] {
  const rows = isRowMutation(decl.sql) ? renderedRows(island) : [...dataset];
  const ordered = [...rows].sort((a, b) => Number(isDone(a)) - Number(isDone(b)));
  const out: Attempt[] = [];
  for (const row of ordered) {
    const values = bindParams(decl, row);
    if (!values) continue;
    out.push(isRowMutation(decl.sql) ? { values, row } : { values });
  }
  // A mutation that needs no row at all (`update … set status='done' where status='doing'`).
  if (!out.length && !isRowMutation(decl.sql)) {
    const values = bindParams(decl, null);
    if (values) out.push({ values });
  }
  // A cell mutation whose `_value` the caller supplies is still a write worth trying.
  if (!out.length && isCellMutation(decl.sql)) {
    const values = bindParams(decl, ordered[0] ?? null);
    if (values) out.push({ values, ...(isRowMutation(decl.sql) && ordered[0] ? { row: ordered[0] } : {}) });
  }
  return out;
}

const isDone = (row: Row): boolean => Object.values(row).some((v) => DONE_RE.test(String(v)));

// ---------------------------------------------------------------- the two reads

/**
 * The dataset as its OWNER reads it back — the rows themselves, which the
 * artifact wire carries for a `dataset` artifact.
 *
 * A failure here THROWS: "we could not read the dataset" is not "the tracker
 * does not work", and scoring it as the latter is the instrument-blindness
 * `checks_ok` exists to refuse.
 */
async function readDatasetRows(ctx: CheckContext, datasetId: string): Promise<Row[]> {
  const url = `${ctx.productUrl}/api/artifacts/${datasetId}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { ...ctx.driverHeaders, authorization: `Bearer ${ctx.token}` } });
  } catch (e) {
    throw new DriverFailure('reading the dataset', `GET ${url} — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw new DriverFailure('reading the dataset', `GET ${url} → ${res.status}`);
  return ((await res.json()) as { rows?: Row[] }).rows ?? [];
}

/**
 * The write, through the door the row button itself uses.
 *
 * A 4xx is the DOCUMENT's answer and comes back as a status and an error code;
 * a 5xx or a socket error is ours and throws.
 */
async function postMutation(
  ctx: CheckContext,
  docId: string,
  body: { mutation: string; values: Record<string, Scalar>; row?: Row },
): Promise<{ status: number; error: string | null }> {
  const url = `${ctx.productUrl}/a/${docId}/mutate`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { ...ctx.driverHeaders, authorization: `Bearer ${ctx.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new DriverFailure('running the mutation', `POST ${url} — ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status >= 500) throw new DriverFailure('running the mutation', `POST ${url} → ${res.status}`);
  const text = await res.text();
  let error: string | null = null;
  try {
    const parsed = JSON.parse(text) as { error?: string; detail?: string; details?: string[] };
    error = parsed.error ? `${parsed.error}${parsed.detail ? `: ${parsed.detail}` : ''}` : null;
  } catch {
    error = res.status === 200 ? null : text.slice(0, 120);
  }
  return { status: res.status, error };
}

// ---------------------------------------------------------------- the kind

export const trackerScorer = {
  kind: 'tracker',
  checkNames: TRACKER_CHECKS,

  /** The tracker starts from a CSV the agent publishes; a task without one grades nothing. */
  validate(task) {
    if (!task.files || Object.keys(task.files).length === 0) {
      return 'a tracker task must stage the file it asks the agent to publish as a writable dataset';
    }
    return null;
  },

  /** Nothing to prepare: the agent is handed a start document and a CSV, like every publish task. */
  async setup() {},

  async checks(ctx: CheckContext) {
    const island = islandOf(ctx.served.html);
    if (!island) {
      ctx.record('mutation_probe', 'the served document carries no story island — there is nothing to write to', 'text');
      return { uses_row_template: false, declares_mutation: false, mutation_works: false, no_iframe: false };
    }
    const probe = await probeMutation(ctx, island);
    ctx.record('mutation_probe', probe.note, 'text');
    return {
      uses_row_template: usesRowTemplate(island),
      declares_mutation: declaresMutation(island),
      mutation_works: probe.ok,
      no_iframe: noIframe(island),
    };
  },
} as const satisfies TaskScorer;

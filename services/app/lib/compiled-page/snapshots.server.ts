/**
 * GUEST SNAPSHOTS — a document version's SHARED queries, answered once for the
 * anonymous reader and stored (app.data_snapshots), so the HTML can carry rows
 * without a per-request run (docs/phase2-architecture.md §5; contract
 * `SnapshotStore`).
 *
 * KEY. `SnapshotKey` = the version slot + a digest of the version's DataPlan +
 * a canonical digest of the values its shared queries read (`keysSnapshot`).
 * A value no shared query reads never keys a snapshot.
 *
 * FRESHNESS IS DECIDED ON READ (the correctness rule). A snapshot stores the
 * mark of every dataset in `DataPlan.datasets` (served-results.server
 * `marksOf`, the same mark the live stream picks up from), taken BEFORE its
 * queries ran. `get` compares them with the current ones in one query: equal
 * and inside SNAPSHOT_MAX_AGE_MS is fresh. That catches every way a dataset
 * changes — a declared mutation, a PUT replacing it, a revert, a sharing or a
 * policy change, a deletion — without any of those paths calling us. The
 * DOCUMENT's own mark is stored beside them (not in `marks`, which is exactly
 * the plan's datasets): the plan digest names reads, not SQL text, so a
 * republish that edits one query's SQL keeps the key and must still read as
 * stale. It also covers `_members` (a membership change bumps the document's
 * sharing revision), which is what `membersMark` carries.
 *
 * EAGER INVALIDATION (the optimisation). The dataset write path calls
 * `invalidate(datasetId)` after its commit, beside its NOTIFY: every snapshot
 * whose plan lists the dataset is flagged (`stale_at`, via the GIN-indexed
 * `datasets` column) and its head is queued for revalidation. Correctness
 * never depends on it — `get` never reads `stale_at`.
 *
 * REVALIDATION. `revalidate(key)` re-runs the shared queries at the key's
 * inputs through the SAME run as `POST /a/:id/query` (`dataflowForRow`, the
 * same engine, caches, caps and timeouts) with anonymous admission, marks
 * taken before the run, and the route's own recheck after it. Only the shared
 * queries' tables and errors are stored: nothing the run computes per viewer. Background
 * revalidation is one worker with one pending entry per key and every failure
 * swallowed (the discipline of prepared-page.server `warmPreparedPage`): a
 * failed revalidation is an older snapshot, never a failed read. Like the
 * prepared-page warm-ups it belongs to a SERVER: the composition root turns it
 * on (`enableSnapshotRevalidations`); a script or a unit test writing a
 * dataset gets no work behind its back.
 *
 * WHAT A KEY RE-RUNS. The contract's key carries digests only, so the plan and
 * the input values it was derived from are remembered when the key is made
 * (`snapshotKeyFor`, a bounded registry) and stored with the snapshot, so a
 * write after a restart still revalidates the head it invalidated.
 */
import { createHash } from 'node:crypto';
import { canReadArtifact, dataflowForRow, getArtifactById } from '@/lib/artifacts';
import { getDb } from '@/lib/db';
import { DatasetError } from '@/lib/datasets/errors';
import type { Scalar } from '@/lib/story/dataflow';
import { marksOf } from '@/lib/story/served-results.server';
import type { ServedResults } from '@/lib/story-runtime/contract';
import {
  SNAPSHOT_INPUT_SETS_PER_ARTIFACT,
  SNAPSHOT_MAX_AGE_MS,
  type DataPlan,
  type DataSnapshot,
  type DrawnChart,
  type SnapshotKey,
  type SnapshotRead,
  type SnapshotSlot,
  type SnapshotStore,
} from './contract';

/**
 * The compiler build a snapshot records until the compiled page carries one
 * (w1-toolchain's build id reaches the store through w3-serve).
 */
export const SNAPSHOT_BUILD_NONE = 'none';

/* ──────────────────────────────────────────────────────────────────────────
 * Keys
 * ────────────────────────────────────────────────────────────────────────── */

/** JSON with every object's keys sorted: the same value is the same bytes. */
function canonical(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}
const digest = (value: unknown): string => createHash('sha256').update(canonical(value)).digest('hex').slice(0, 16);

/** The values a snapshot of this plan is keyed by: every `keysSnapshot` input at the given value, else its default. */
function keyedValues(plan: DataPlan, values: Readonly<Record<string, Scalar | undefined>>): Record<string, Scalar> {
  return Object.fromEntries(plan.values.filter((v) => v.keysSnapshot).map((v) => [v.name, Object.hasOwn(values, v.name) ? (values[v.name] ?? null) : v.default]));
}

/** What a key re-runs: the plan and the keyed input values it was made from. */
interface Recipe {
  plan: DataPlan;
  values: Record<string, Scalar>;
}

const keyString = (key: SnapshotKey): string => `${key.artifactId}\u0000${key.slot}\u0000${key.planKey}\u0000${key.inputsKey}`;

/** Recently made keys → their recipe, so the first revalidation of a key needs nothing stored. Bounded, most recent kept. */
const RECIPES_KEPT = 1024;
const recipes = new Map<string, Recipe>();
function remember(key: SnapshotKey, recipe: Recipe): void {
  const k = keyString(key);
  recipes.delete(k);
  recipes.set(k, recipe);
  while (recipes.size > RECIPES_KEPT) recipes.delete(recipes.keys().next().value!);
}

/**
 * The key of this version's snapshot at these values. `planKey` is the plan's
 * canonical digest; `inputsKey` digests only the values a shared query reads
 * (the plan's `keysSnapshot` inputs; an absent one at its default).
 */
export function snapshotKeyFor(artifactId: string, slot: SnapshotSlot, plan: DataPlan, values: Readonly<Record<string, Scalar | undefined>>): SnapshotKey {
  const keyed = keyedValues(plan, values);
  const key: SnapshotKey = { artifactId, slot, planKey: digest(plan), inputsKey: digest(keyed) };
  remember(key, { plan, values: keyed });
  return key;
}

/* ──────────────────────────────────────────────────────────────────────────
 * The stored row
 * ────────────────────────────────────────────────────────────────────────── */

/** What the `snapshot` column holds: the snapshot's body, what re-runs it, and the document's mark. */
interface StoredBody {
  results: ServedResults;
  drawings: Record<string, DrawnChart>;
  build: string;
  membersMark?: string;
  /** The document's own mark, taken before the run (null for a snapshot `put` without one). */
  document: string | null;
  recipe: Recipe | null;
}
interface StoredRow {
  artifact_id: string;
  slot: string;
  plan_key: string;
  inputs_key: string;
  marks: Record<string, string> | null;
  snapshot: StoredBody | null;
  computed_at: Date | string | null;
}

/** A dataset with no row has no mark; this stands in so a vanished dataset compares unequal to a live one. */
const NO_MARK = '-';

const SELECT_ROW = 'SELECT artifact_id, slot, plan_key, inputs_key, marks, snapshot, computed_at FROM data_snapshots WHERE artifact_id = $1 AND slot = $2 AND plan_key = $3 AND inputs_key = $4';

async function storedRow(key: SnapshotKey): Promise<StoredRow | null> {
  return (await (await getDb()).query<StoredRow>(SELECT_ROW, [key.artifactId, key.slot, key.planKey, key.inputsKey])).rows[0] ?? null;
}

function snapshotOf(row: StoredRow): DataSnapshot | null {
  if (!row.snapshot || !row.marks) return null;
  const { results, drawings, build, membersMark } = row.snapshot;
  return {
    key: { artifactId: row.artifact_id, slot: row.slot as SnapshotSlot, planKey: row.plan_key, inputsKey: row.inputs_key },
    marks: row.marks,
    ...(membersMark === undefined ? {} : { membersMark }),
    results,
    drawings: drawings ?? {},
    computedAt: row.computed_at === null ? 0 : new Date(row.computed_at).getTime(),
    build,
  };
}

/** What a guest snapshot may hold of a run's answer: the tables and errors, never a per-viewer field. */
const sharedResults = (results: ServedResults): ServedResults => ({ tables: results.tables, errors: results.errors });

async function write(snapshot: DataSnapshot, extra: Pick<StoredBody, 'document' | 'recipe'>): Promise<void> {
  const { key } = snapshot;
  const body: StoredBody = {
    results: sharedResults(snapshot.results),
    drawings: { ...snapshot.drawings },
    build: snapshot.build,
    ...(snapshot.membersMark === undefined ? {} : { membersMark: snapshot.membersMark }),
    ...extra,
  };
  const db = await getDb();
  await db.query(
    `INSERT INTO data_snapshots (artifact_id, slot, plan_key, inputs_key, datasets, marks, snapshot, stale_at, computed_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::text[], $6::jsonb, $7::jsonb, NULL, $8::timestamptz, now())
     ON CONFLICT (artifact_id, slot, plan_key, inputs_key) DO UPDATE SET datasets = EXCLUDED.datasets, marks = EXCLUDED.marks,
       snapshot = EXCLUDED.snapshot, stale_at = NULL, computed_at = EXCLUDED.computed_at, updated_at = now()`,
    [key.artifactId, key.slot, key.planKey, key.inputsKey, Object.keys(snapshot.marks), JSON.stringify(snapshot.marks), JSON.stringify(body), new Date(snapshot.computedAt).toISOString()],
  );
  // THE BOUND (open question Q2): past the default input set, at most SNAPSHOT_INPUT_SETS_PER_ARTIFACT input
  // sets per version plan are kept, least recently written first out; beyond it the cold path answers.
  if (!extra.recipe || digest(keyedValues(extra.recipe.plan, {})) === key.inputsKey) return;
  await db.query(
    `DELETE FROM data_snapshots d WHERE d.artifact_id = $1 AND d.slot = $2 AND d.plan_key = $3 AND d.inputs_key <> $4
       AND d.inputs_key NOT IN (SELECT k.inputs_key FROM data_snapshots k WHERE k.artifact_id = $1 AND k.slot = $2 AND k.plan_key = $3 AND k.inputs_key <> $4
                                 ORDER BY k.updated_at DESC, k.inputs_key LIMIT $5)`,
    [key.artifactId, key.slot, key.planKey, digest(keyedValues(extra.recipe.plan, {})), SNAPSHOT_INPUT_SETS_PER_ARTIFACT],
  );
}

async function forget(key: SnapshotKey): Promise<void> {
  await (await getDb()).query('DELETE FROM data_snapshots WHERE artifact_id = $1 AND slot = $2 AND plan_key = $3 AND inputs_key = $4', [key.artifactId, key.slot, key.planKey, key.inputsKey]);
}

/* ──────────────────────────────────────────────────────────────────────────
 * Revalidation
 * ────────────────────────────────────────────────────────────────────────── */

const pick = <T>(from: Record<string, T> | undefined, names: ReadonlySet<string>): Record<string, T> =>
  Object.fromEntries(Object.entries(from ?? {}).filter(([name]) => names.has(name)));

async function revalidateKey(key: SnapshotKey): Promise<DataSnapshot | null> {
  // An archived version is readable only through its editors' history scope (lib/archived-version
  // `archivedVersionForActor` refuses a null actor), so no anonymous snapshot of one can exist.
  if (key.slot !== 'head') return null;
  const stored = await storedRow(key);
  const recipe = recipes.get(keyString(key)) ?? stored?.snapshot?.recipe ?? null;
  if (!recipe) return null;
  const { plan, values } = recipe;
  const shared = plan.queries.filter((q) => q.scope === 'shared').map((q) => q.name);
  const row = await getArtifactById(key.artifactId);
  // The anonymous door's own admission: a document a guest cannot read has no guest snapshot.
  if (!row || row.format !== 'markup' || !shared.length || !(await canReadArtifact(row, null))) return null;
  // TODO(w1-planners planOf): recompute this head's plan (`planOf(flow, anonymous access facts)`) and, when its
  // digest is not `key.planKey`, forget the row and answer null. Until then a plan whose shared queries the head
  // no longer declares is the one mismatch detectable here.
  // Marked BEFORE the run: a write after this is caught by the next comparison, never lost.
  const current = await marksOf([...plan.datasets, row.id]);
  const marks = Object.fromEntries(plan.datasets.map((id) => [id, current.get(id) ?? NO_MARK]));
  const document = current.get(row.id) ?? NO_MARK;
  // The query route's recheck: the same version, still readable by the anonymous door, after every wait.
  const authorize = async () => {
    const now = await getArtifactById(row.id);
    if (!now || now.edit_id !== row.edit_id || !(await canReadArtifact(now, null))) throw new DatasetError('Document is unavailable', 404);
  };
  let ran;
  try {
    ran = await dataflowForRow(row, { values, only: shared, viewer: null, authorize });
    await authorize();
  } catch (error) {
    if (error instanceof DatasetError) return null;
    throw error;
  }
  if (!ran) return null;
  const declared = new Set(ran.flow.queries.map((q) => q.name));
  if (shared.some((name) => !declared.has(name))) {
    await forget(key);
    return null;
  }
  const answered = new Set(shared);
  const { state } = ran;
  // The shared queries' tables and errors, and NOTHING else the run attaches: its mutation access, user
  // options and person cards are computed for whoever the run is for (the viewer overlay's to answer).
  const results = sharedResults({ tables: pick(state.tables, answered), errors: pick(state.errors, answered) });
  // TODO(w1-planners drawSnapshotCharts): draw the version's <Question> charts from `results` —
  // `drawSnapshotCharts(page.data.nodes, results, { colorMode: page.data.colorMode })` over
  // `preparedPageFor(row, null, PUBLIC_BASE_URL)` — once charts.server.ts has merged.
  const drawings: Record<string, DrawnChart> = {};
  const snapshot: DataSnapshot = {
    key: { artifactId: key.artifactId, slot: key.slot, planKey: key.planKey, inputsKey: key.inputsKey },
    marks,
    ...(plan.readsMembers ? { membersMark: document } : {}),
    results,
    drawings,
    computedAt: Date.now(),
    build: stored?.snapshot?.build ?? SNAPSHOT_BUILD_NONE,
  };
  await write(snapshot, { document, recipe });
  return snapshot;
}

/*
 * THE WORKER. One loop, one pending entry per key (a burst of writes revalidates
 * a head once), every failure swallowed. A microtask, not a timer: a test's fake
 * clock must never strand the queue.
 */
const queued = new Map<string, SnapshotKey>();
const invalidating = new Set<Promise<unknown>>();
let worker: Promise<void> | null = null;
let revalidating = false;

/** Background revalidation belongs to a serving process: its composition root turns it on. */
export function enableSnapshotRevalidations(): void { revalidating = true; }

function queueRevalidation(key: SnapshotKey): void {
  if (!revalidating || key.slot !== 'head') return;
  queued.set(keyString(key), key);
  if (worker) return;
  worker = Promise.resolve().then(async () => {
    while (queued.size) {
      const [k, next] = queued.entries().next().value!;
      queued.delete(k);
      try {
        await revalidateKey(next);
      } catch (error) {
        console.warn('[snapshots] revalidation failed', next.artifactId, error);
      }
    }
  }).finally(() => { worker = null; });
}

/** Wait for every in-flight invalidation and queued revalidation (tests; a graceful shutdown). */
export async function drainSnapshotRevalidations(): Promise<void> {
  while (invalidating.size || worker) {
    await Promise.allSettled([...invalidating]);
    if (worker) await worker;
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * The store
 * ────────────────────────────────────────────────────────────────────────── */

async function freshness(row: StoredRow, snapshot: DataSnapshot): Promise<boolean> {
  if (Date.now() - snapshot.computedAt > SNAPSHOT_MAX_AGE_MS) return false;
  const datasets = Object.keys(snapshot.marks);
  const current = await marksOf([...datasets, snapshot.key.artifactId]);
  if (datasets.some((id) => (current.get(id) ?? NO_MARK) !== snapshot.marks[id])) return false;
  const document = row.snapshot?.document ?? null;
  return document === null || (current.get(snapshot.key.artifactId) ?? NO_MARK) === document;
}

async function invalidateDataset(datasetId: string): Promise<SnapshotKey[]> {
  const rows = (await (await getDb()).query<Pick<StoredRow, 'artifact_id' | 'slot' | 'plan_key' | 'inputs_key'>>(
    `UPDATE data_snapshots SET stale_at = coalesce(stale_at, now()) WHERE $1 = ANY(datasets)
     RETURNING artifact_id, slot, plan_key, inputs_key`,
    [datasetId],
  )).rows;
  const keys = rows
    .map((r): SnapshotKey => ({ artifactId: r.artifact_id, slot: r.slot as SnapshotSlot, planKey: r.plan_key, inputsKey: r.inputs_key }))
    .sort((a, b) => keyString(a).localeCompare(keyString(b)));
  for (const key of keys) queueRevalidation(key);
  return keys;
}

/** The snapshot store over `app.data_snapshots`. Stateless: every instance reads and writes the same rows. */
export function createSnapshotStore(): SnapshotStore {
  return {
    async get(key) {
      const row = await storedRow(key);
      const snapshot = row && snapshotOf(row);
      if (!row || !snapshot) return null;
      return { snapshot, fresh: await freshness(row, snapshot) } satisfies SnapshotRead;
    },

    /*
     * A snapshot made elsewhere (a request's own run). It keeps what re-runs it —
     * the recipe its key was made with, else the stored one — and the document mark
     * already stored for the key; with none, the document's mark is taken now.
     */
    async put(snapshot) {
      const stored = await storedRow(snapshot.key);
      const recipe = recipes.get(keyString(snapshot.key)) ?? stored?.snapshot?.recipe ?? null;
      const document = stored?.snapshot?.document ?? (await marksOf([snapshot.key.artifactId])).get(snapshot.key.artifactId) ?? null;
      await write(snapshot, { document, recipe });
    },

    invalidate(datasetId) {
      const pending = invalidateDataset(datasetId);
      invalidating.add(pending);
      void pending.catch(() => {}).finally(() => invalidating.delete(pending));
      return pending;
    },

    revalidate: revalidateKey,
  };
}

/** The store the dataset write path invalidates through. */
export const snapshotStore: SnapshotStore = createSnapshotStore();

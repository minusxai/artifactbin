/**
 * THE PAGE SQL DOOR: one reader-authored SQL statement over the page's dataset links,
 * read or write, as the reader through the page (the page audience rule, `X-Hasura-Page-Id` the page). Tables are
 * link names (single-table dataset `<link>`, multi-table `<link>.<table>`), every table carries `_id`.
 *
 * READS are `_sql` (./page-sql) without the `allow_aggregations` gate: the reader aggregates over the rows the role
 * view shows, nothing more. The loaded links' read fences are checked before the answer leaves.
 *
 * WRITES run in two phases, so the reader's SQL text is NEVER prepared against stored rows:
 *
 *  1. THE VISIBLE WORLD. The statement runs on the SQL service against the reader's role view of its target (the
 *     select rule's rows and columns, `_id`, and the columns the role may write but not read, NULL in every row),
 *     with every other table it names mounted read-only as the reader's role view. The engine's guard holds here
 *     (one INSERT/UPDATE/DELETE of the one target, no DDL/PRAGMA/ATTACH/transactions/RETURNING, allowed functions
 *     less PAGE_SQL_DENIED_FUNCTIONS). Whatever the statement reads, a subquery, an error, a count, its timing,
 *     depends on visible data only. Its EFFECT is recorded: inserted rows and the columns they named, updated row
 *     ids with the assigned columns' new values, deleted row ids.
 *  2. THE GUARDED WRITE PATH. The effect is compiled to row-addressed statements over the stored table, bound
 *     values only, the way ./hasura-write compiles a generated mutation, and written by lib/document-data
 *     `mutateDataset` with exactly the generated API's guard: the role's insert/update/delete rule as the engine
 *     enforces it (columns, filter as row-level security, presets, check on the effect), the decision again under
 *     the row lock, the public-write rate limit, at most DATASET_SQL_WRITE_LIMITS.rows rows, `_id`s generated
 *     from the Idempotency-Key, the reply saved in the committing transaction (a replay answers it exactly).
 *
 * Phase 2's values are phase 1's results, frozen (`n = n + 1` became `n = 6`), so a lost version CAS must not
 * re-run them: the write is pinned to the head phase 1 read (`expectedState`, no internal retry) and a moved
 * head re-runs BOTH phases on the new one, a bounded number of times.
 *
 * A row inside the update/delete filter but outside the select filter is not reachable: only visible rows
 * exist in phase 1.
 */
import { createHash, randomUUID } from 'node:crypto';
import { DatasetAccessError } from './errors';
import { DATASET_SQL_WRITE_LIMITS, SQL_READ_LIMITS, type DatasetColumn, type DatasetMutationPolicy, type HtmlDatasetLink, type Row, type Scalar } from '@artifactbin/contracts';
import { loadSqlite } from '@artifactbin/sql/core';
import type { AccessActor } from '@/lib/accounts';
import { artifactState, completeMutationReceipt, durableMutation, getArtifactById, type ArtifactRow } from '@/lib/artifacts';
import { isMutationRefused, mutateDataset, type MutationStep } from '@/lib/document-data';
import { MAX_QUERY_ROWS } from '@/lib/platform';
import { isQueryFailure, sqlExtensions } from '@/lib/sql';
import { mutateMounted, type CatalogMount } from '@/lib/datasets';
import { loadLinked, sqlRefusal, type LoadedDataset, type PageCommitGuard } from './linked';
import { authorityShape, readAuthorityIn, rowsNow, shownRows, type ReadAuthority } from './write-reply';
import { readIdentityIn } from './retained';
import { ID_COLUMN, quote, rowIdsForObject, tableIdentity } from './model';
import { jsonBytes, runPageSql } from './page-sql';

/** One statement and its bound values (`$name`), as the page runtime's `sql` tag sends them. */
interface PageSqlDoorCall { sql: string; params: Readonly<Record<string, Scalar>> }
export interface PageSqlDoorScope {
  pageId: string;
  /** Writes: the client's Idempotency-Key (one per `sql` write); absent, a fresh one. */
  idempotencyKey?: string;
  /** The page is read here only (an archived revision, a read-only frame): any write is refused. */
  readOnly?: boolean;
  /** The page the write goes through, re-decided inside the commit (lib/page-doors): head, links, the reader's access. */
  commitGuard?: PageCommitGuard;
}
export interface PageSqlDoorReply { status: number; body: Record<string, unknown> }

/**
 * Functions a reader's write may not call, beyond what the engine never offers (load_extension, readfile, sqlite_*,
 * connection state): those whose result differs between runs, so a re-run on a new head or a replayed receipt could
 * not mean the same write. Pass the value as a parameter instead.
 */
const PAGE_SQL_DENIED_FUNCTIONS = ['random', 'randomblob', 'uuid', 'current_date', 'current_time', 'current_timestamp', 'load_extension', 'readfile', 'writefile', 'edit', 'changes', 'last_insert_rowid', 'total_changes'] as const;
/** Re-runs of both phases when the head moved under the write. */
const WRITE_ATTEMPTS = 8;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const PARAM = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const STATUS: Record<string, number> = { validation_failed: 400, input_too_large: 413, result_too_large: 413, too_many_rows: 413, permission_denied: 403, check_violation: 403, timeout: 408, dataset_changed: 409, outcome_unknown: 409, dataset_not_found: 404 };
const fail = (code: string, message: string): PageSqlDoorReply => ({ status: STATUS[code] ?? 400, body: { error: code, message } });
class Refusal extends Error { constructor(readonly code: string, message: string) { super(message); } }
const refuse = (code: string, message: string): never => { throw new Refusal(code, message); };
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
const mentions = (sql: string, link: string) => sql.toLowerCase().includes(link.toLowerCase());

/** Arguments, checked for every caller alike: one statement of at most SQL_READ_LIMITS.sqlBytes, scalar params. */
function checked(call: { sql?: unknown; params?: unknown }): PageSqlDoorCall {
  const { sql, params = {} } = call;
  if (typeof sql !== 'string' || !sql.trim()) refuse('validation_failed', 'sql takes one SQL statement');
  if (new TextEncoder().encode(sql as string).length > SQL_READ_LIMITS.sqlBytes) refuse('input_too_large', `a statement is at most ${SQL_READ_LIMITS.sqlBytes} bytes`);
  if (!params || typeof params !== 'object' || Array.isArray(params)) refuse('validation_failed', 'params must be an object of scalars');
  const entries = Object.entries(params as Record<string, unknown>);
  if (entries.length > SQL_READ_LIMITS.params) refuse('input_too_large', `at most ${SQL_READ_LIMITS.params} params`);
  for (const [key, value] of entries) {
    const scalar = value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
    if (!PARAM.test(key) || !scalar) refuse('validation_failed', `param ${key.slice(0, 64)} must be a string, number, boolean or null under an identifier`);
  }
  return { sql: sql as string, params: params as Record<string, Scalar> };
}

/** One linked table as phase 1 mounts it: SQL names, the reader's columns (and write-only ones) and its loaded link. */
interface Mounted {
  loaded: LoadedDataset;
  table: LoadedDataset['tables'][number];
  schema: string;
  name: string;
  /** The role view's columns, `_id` first. */
  visible: DatasetColumn[];
  /** Columns the role may write but not read: present, NULL in every row. */
  writeOnly: DatasetColumn[];
}

function mountsOf(loaded: readonly LoadedDataset[], sql: string): Mounted[] {
  const out: Mounted[] = [];
  for (const l of loaded) {
    const link = l.link!.name;
    if (!mentions(sql, link)) continue;
    const single = (l.snapshot ? Object.keys(l.snapshot.names ?? {}).length : l.tables.length) <= 1;
    for (const t of l.tables) {
      const view = t.model.select === false ? undefined : l.snapshot?.catalog.tables.find((v) => tableIdentity(v) === t.tableId);
      if (view?.sql !== undefined || t.declared.sql !== undefined) continue;
      if (t.declared.columns.some((c) => c.name.toLowerCase() === '_id')) continue;
      const visible: DatasetColumn[] = [{ name: '_id', type: 'string' }, ...(view?.columns ?? []).map((c) => ({ name: c.name, type: c.type }))];
      const writable = [...(t.model.write?.insert ?? []), ...(t.model.write?.update ?? [])].map((c) => c.source);
      const writeOnly = t.declared.columns.filter((c) => writable.includes(c.name) && !visible.some((v) => v.name === c.name)).map((c) => ({ name: c.name, type: c.type }));
      if (!view && !writeOnly.length) continue;
      out.push({ loaded: l, table: t, schema: single ? 'main' : link, name: single ? link : t.declared.name, visible, writeOnly });
    }
  }
  return out;
}

/**
 * One mounted table as the read path mounts it (./page-sql, lib/datasets `executeMounted`): the role view's catalog
 * table, its columns with `_id`, the snapshot's row IDs and role view. The same mount is the same content key, so a
 * write's visible copy is the SQL service's prepared database a read already built (and the other way round).
 * Null when the role reads nothing of it (a table it only writes).
 */
function catalogMount(m: Mounted): CatalogMount | null {
  const snapshot = m.loaded.snapshot;
  if (!snapshot || m.table.model.select === false) return null;
  const stored = snapshot.catalog.tables.find((v) => tableIdentity(v) === m.table.tableId);
  if (!stored) return null;
  return { schema: m.schema, name: m.name, columns: m.visible, stored, view: snapshot.view ?? null, rowIds: { column: ID_COLUMN, ids: snapshot.rowIds[m.table.tableId] ?? [], as: '_id' } };
}

/** What the statement is, by SQLite's own analysis over the reader's tables (shapes only, no rows). */
async function analyzed(mounts: readonly Mounted[], sql: string) {
  const relations = mounts.map((m) => ({ schema: m.schema, table: m.name, columns: [...m.visible, ...m.writeOnly] }));
  try { return (await loadSqlite()).analyze(sql, relations, { mode: 'write', extensions: sqlExtensions() }); }
  catch (e) { return refuse('validation_failed', e instanceof Error ? e.message : 'the statement was refused'); }
}

/** A phase-1 policy that judges nothing but functions: the reader's rules are judged in phase 2, on stored rows. */
function visibleWorldPolicy(m: Mounted): DatasetMutationPolicy {
  return {
    table: {
      table: { schema: m.schema, name: m.name },
      insert_permissions: [{ role: 'reader', permission: { columns: '*', check: {} } }],
      update_permissions: [{ role: 'reader', permission: { columns: '*', filter: {}, check: {} } }],
      delete_permissions: [{ role: 'reader', permission: { filter: {} } }],
    },
    role: 'reader', session: {}, operations: ['insert', 'update', 'delete'], rowId: '_id',
    execution: { functions: { deny: [...PAGE_SQL_DENIED_FUNCTIONS] } },
  };
}

/** Phase 1's recorded effect. */
type Effect =
  | { op: 'insert'; columns: string[]; rows: Row[] }
  | { op: 'update'; columns: string[]; rows: Row[] }
  | { op: 'delete'; ids: string[] };

async function phaseOne(target: Mounted, others: readonly Mounted[], call: PageSqlDoorCall, signal: AbortSignal): Promise<Effect> {
  // Every table the statement can name is a keyed mount of the reader's role view: nothing else exists in phase 1.
  const mounts = [target, ...others].flatMap((m) => { const mount = catalogMount(m); return mount ? [mount] : []; });
  const out = await mutateMounted(mounts, {
    policy: visibleWorldPolicy(target),
    table: { schema: target.schema, name: target.name, columns: [...target.visible, ...target.writeOnly], rows: [] },
    sql: call.sql, params: { ...call.params }, identity: '_id', limit: MAX_QUERY_ROWS, answer: 'written',
  }, { signal });
  if (isQueryFailure(out)) {
    if (out.timedOut) refuse('timeout', out.error);
    refuse('validation_failed', out.error.replace(/^Dataset policy: /, ''));
  }
  const result = out as Exclude<typeof out, { error: string }>;
  const analysis = result.analysis ?? refuse('validation_failed', 'the statement was refused');
  if (analysis.columns.some((c) => c.toLowerCase() === '_id')) refuse('validation_failed', '_id is the platform\'s row ID: it is generated on insert and never written');
  if (result.affected > DATASET_SQL_WRITE_LIMITS.rows) refuse('too_many_rows', `a write changes at most ${DATASET_SQL_WRITE_LIMITS.rows} rows; nothing was written`);
  const written = (result.written ?? []) as Scalar[];
  if (analysis.operation === 'delete') return { op: 'delete', ids: written.map(String) };
  if (analysis.operation === 'insert') {
    const inserted = result.rows;
    if (inserted.length !== result.affected || inserted.some((r) => r._id !== null && r._id !== undefined)) refuse('validation_failed', '_id is the platform\'s row ID: it is generated on insert and never written');
    return { op: 'insert', columns: analysis.columns, rows: inserted };
  }
  const byId = new Map(result.rows.map((r) => [r._id, r]));
  return { op: 'update', columns: analysis.columns, rows: written.map((id) => byId.get(id)!).filter(Boolean) };
}

/** Phase 1's effect as one row-addressed statement over the stored table (bound values only, as ./hasura-write). */
function compiled(effect: Effect, stored: { schema: string; name: string }, id: (j: number) => string): { sql: string; params: Record<string, Scalar> } {
  const target = `${quote(stored.schema)}.${quote(stored.name)}`, key = quote(ID_COLUMN);
  const params: Record<string, Scalar> = {};
  const bind = (name: string, value: unknown) => { params[name] = (value ?? null) as Scalar; return `$${name}`; };
  if (effect.op === 'delete') {
    const ids = effect.ids.map((v, i) => bind(`k${i}`, v));
    return { sql: `DELETE FROM ${target} WHERE ${ids.length ? `${key} IN (${ids.join(', ')})` : '0'}`, params };
  }
  if (effect.op === 'insert') {
    const columns = [...effect.columns.map(quote), key];
    if (!effect.rows.length) return { sql: `INSERT INTO ${target} (${columns.join(', ')}) SELECT ${columns.map(() => 'NULL').join(', ')} WHERE 0`, params };
    const values = effect.rows.map((row, i) => `(${[...effect.columns.map((c, j) => bind(`v${i}_${j}`, row[c])), bind(`id${i}`, id(i))].join(', ')})`);
    return { sql: `INSERT INTO ${target} (${columns.join(', ')}) VALUES ${values.join(', ')}`, params };
  }
  if (!effect.columns.length) refuse('validation_failed', 'an UPDATE assigns at least one column');
  if (!effect.rows.length) return { sql: `UPDATE ${target} SET ${effect.columns.map((c) => `${quote(c)} = ${quote(c)}`).join(', ')} WHERE 0`, params };
  const ids = effect.rows.map((r, i) => bind(`k${i}`, r._id));
  const sets = effect.columns.map((c, j) => `${quote(c)} = CASE ${key} ${effect.rows.map((r, i) => `WHEN ${ids[i]} THEN ${bind(`s${i}_${j}`, r[c])}`).join(' ')} END`);
  return { sql: `UPDATE ${target} SET ${sets.join(', ')} WHERE ${key} IN (${ids.join(', ')})`, params };
}

/** The written rows as the reader's select rule shows them, by SQL column name. */
function returning(authority: ReadAuthority | null, m: Mounted, op: Effect['op'], step: MutationStep | undefined): Row[] {
  if (!step?.written.length || m.table.model.select === false) return [];
  return shownRows(authority, m.table.declared, op === 'delete' ? step.before : step.after, step.written).map(sqlRow);
}
/** A stored-shape row (./write-reply) as the door answers it: `_id` first, then the visible columns by SQL name. */
const sqlRow = (row: Record<string, unknown>): Row => {
  const { [ID_COLUMN]: id, ...rest } = row;
  return { _id: id as Scalar, ...(rest as Row) };
};

/** A pinned link never writes: it reads its recorded revision, and has no mutation roots. */
function pinned(m: Mounted): void {
  if (m.loaded.link?.mode === 'pinned') refuse('permission_denied', `${m.loaded.link.name} is pinned to a revision: it is read-only`);
}
/** The target's rule must allow this operation (the generated API's mutation roots); a pinned link has none. */
function writable(m: Mounted, op: string): void {
  pinned(m);
  const w = m.table.model.write;
  const can = op === 'insert' ? !!w?.insert?.length : op === 'update' ? !!w?.update?.length : op === 'delete' ? !!w?.delete : false;
  if (!can) refuse('permission_denied', `your role may not ${op} rows of ${m.name}`);
}

/** A receipt's outcome identity and its authority marker (./write-reply); never replied. */
const OUTCOME = '__afOutcome';
const READ_SHAPE = '__afReadShape';

/**
 * A write's reply within SQL_READ_LIMITS.outputBytes, as it is answered and saved in its receipt: written rows past
 * the budget are not returned (`returningOmitted`), the write itself stands.
 */
function bounded(affected: number, rows: Row[], omitted?: string): Record<string, unknown> {
  const body = { affected, returning: rows, ...(omitted ? { returningOmitted: omitted } : {}) };
  return jsonBytes(body) <= SQL_READ_LIMITS.outputBytes ? body : { affected, returning: [], returningOmitted: 'result_too_large' };
}

/** A receipt's body: the count and the outcome identity (operation, written `_id`s), never rows. */
const outcomeBody = (affected: number, op: Effect['op'], step: MutationStep | undefined, shape: string | undefined): Record<string, unknown> =>
  ({ affected, [OUTCOME]: { op, ids: (step?.written ?? []).map(String) }, ...(shape === undefined ? {} : { [READ_SHAPE]: shape }) });

/** One page SQL call. Throws `dataset_changed` when a read's fence fails (the page door re-runs reads). */
export async function executePageSql(actor: AccessActor, links: readonly HtmlDatasetLink[], raw: { sql?: unknown; params?: unknown }, scope: PageSqlDoorScope, signal: AbortSignal): Promise<PageSqlDoorReply> {
  try {
    const call = checked(raw);
    const load = (fenced: boolean) => loadLinked(actor, links, { pageId: scope.pageId, fenced }, signal).catch((e) => { if (e instanceof DatasetAccessError) refuse('validation_failed', e.message); throw e; });
    const first = await load(true);
    if (!first.length) refuse('dataset_not_found', 'no linked dataset is readable');
    const mounts = mountsOf(first, call.sql);
    const analysis = await analyzed(mounts, call.sql);
    if (analysis.kind === 'select') {
      const answer = await runPageSql(first.map((l) => ({ link: l.link!.name, snapshot: l.snapshot, tables: l.tables.map((t) => ({ tableId: t.tableId, selectable: t.model.select !== false })) })), call, signal, { aggregates: 'visible' })
        .catch((e) => { if (e instanceof DatasetAccessError) refuse(String(e.extensions?.code ?? 'validation_failed'), e.message); throw e; });
      for (const l of first) for (const verify of l.fences) await verify();
      return { status: 200, body: { ...answer } };
    }
    if (scope.readOnly) refuse('permission_denied', 'this page is read-only here: it reads, it never writes');
    return await write(actor, call, scope, mounts, analysis.writes[0]!, () => load(false), signal);
  } catch (e) {
    if (e instanceof Refusal) return fail(e.code, e.message);
    throw e;
  }
}

async function write(actor: AccessActor, call: PageSqlDoorCall, scope: PageSqlDoorScope, mounts: readonly Mounted[], written: { schema: string; table: string }, reload: () => Promise<LoadedDataset[]>, signal: AbortSignal): Promise<PageSqlDoorReply> {
  const named = (m: Mounted) => m.schema.toLowerCase() === written.schema.toLowerCase() && m.name.toLowerCase() === written.table.toLowerCase();
  const first = mounts.find(named) ?? refuse('validation_failed', `${written.table} is not a table this page links`);
  const datasetId = first.loaded.datasetId, tableId = first.table.tableId, stored = first.table.declared;
  pinned(first);
  const key = scope.idempotencyKey ?? randomUUID();
  if (!IDEMPOTENCY_KEY.test(key)) refuse('validation_failed', 'the Idempotency-Key must be 16 to 128 letters, digits, - or _');
  const seed = digest(['page-sql', datasetId, key, scope.pageId]);
  const payload = { door: 'page-sql', datasetId, pageId: scope.pageId, sql: call.sql, params: call.params };
  let fresh: Record<string, unknown> | null = null;
  const outcome = await durableMutation(actor, 'https://dataset.invalid', seed, payload, async (receipt) => {
    try {
      let current = mounts;
      for (let attempt = 0; ; attempt++) {
        const target = attempt === 0 ? first : (current = mountsOf(await reload(), call.sql)).find(named) ?? refuse('dataset_changed', 'the linked dataset or your access changed; retry');
        pinned(target);
        // Everything phase 1 reads (the target's role view and every other link mounted) is a read dependency: its
        // authorization is decided again inside the commit, under the row lock, or nothing commits.
        const reads = [...new Map(current.flatMap((m) => (m.loaded.snapshot ? [[m.loaded.datasetId, m.loaded.snapshot.policyIdentity] as const] : []))).entries()];
        // The head phase 1 reads: the role view's own, or (a role that only writes) the head as it is now.
        const head: ArtifactRow | undefined = target.loaded.snapshot?.head ?? await getArtifactById(datasetId) ?? undefined;
        if (!head || head.format !== 'dataset') refuse('dataset_not_found', 'the dataset no longer exists');
        const effect = await phaseOne(target, current.filter((m) => m !== target), call, signal);
        // The rule is decided on every attempt's load, as the generated API's mutation roots are (after the visible
        // world judged the statement's own shape, before anything is written).
        writable(target, effect.op);
        const statement = compiled(effect, stored, (j) => `r_${digest([seed, 0, j])}`);
        const result = await mutateDataset(head!, actor, statement.sql, statement.params, {
          target: { schema: stored.schema, table: stored.name },
          statements: [statement],
          pagePolicy: scope.pageId,
          expectedState: artifactState(head!),
          casRetries: 0,
          maxAffected: DATASET_SQL_WRITE_LIMITS.rows,
          trace: true,
          // The public-write rate limit is charged once per call: the first attempt's, never a retry's.
          // Every other dataset phase 1 read is locked with the authorization rows, before the decisions.
          lockReads: reads.map(([id]) => id).filter((id) => id !== datasetId),
          throttled: attempt > 0,
          commitCheck: async (tx) => {
            await scope.commitGuard?.(tx);
            for (const [id, identity] of reads) if (await readIdentityIn(tx, actor, id, scope.pageId) !== identity) return false;
            return true;
          },
          // Phase 2 is compiled: it calls no function at all.
          execution: { functions: { allow: [] } },
          rowIdentity: { column: ID_COLUMN, tableId, ids: (row: ArtifactRow, objectKey: string, count: number) => rowIdsForObject(row.id, tableId, objectKey, count, (row.meta as { graphqlRowIds?: Record<string, unknown> }).graphqlRowIds?.[tableId]) },
          // Inside the commit: the reply's rows under the read access that holds now (decided on `tx`); the receipt
          // keeps only the outcome identity, never rows.
          commitEffect: async (tx, applied) => {
            const step = applied.steps?.[0];
            const authority = await readAuthorityIn(tx, actor, datasetId, scope.pageId);
            fresh = bounded(applied.affected, returning(authority, target, effect.op, step));
            await completeMutationReceipt(tx, receipt, { status: 200, body: outcomeBody(applied.affected, effect.op, step, authorityShape(authority)) });
          },
        });
        if (!isMutationRefused(result)) return { status: 200, body: outcomeBody(result.affected, effect.op, result.steps?.[0], undefined) };
        // A refused attempt (an exhausted conflict retry included) has no reply, whatever an aborted attempt built.
        fresh = null;
        if ((result.reason === 'row_changed' || result.reason === 'contended') && attempt + 1 < WRITE_ATTEMPTS) continue;
        const refused = sqlRefusal(result);
        return fail(refused.code, refused.message);
      }
    } catch (e) {
      if (e instanceof Refusal) return fail(e.code, e.message);
      throw e;
    }
  });
  if (outcome.status === 200 && fresh) return { status: 200, body: fresh };
  if (outcome.status === 200) {
    const body = outcome.body as { affected?: number; returning?: unknown; [OUTCOME]?: { op: Effect['op']; ids: string[] }; [READ_SHAPE]?: string };
    const affected = Number(body.affected ?? 0), recorded = body[OUTCOME];
    // A receipt that records no authority is an older format: its rows are never shown, its ids (recorded, or those
    // of the rows it held) are only counted.
    const legacy = !recorded || body[READ_SHAPE] === undefined;
    const ids = recorded?.ids ?? (Array.isArray(body.returning) ? body.returning.flatMap((r) => (r && typeof r === 'object' && typeof (r as { _id?: unknown })._id === 'string' ? [(r as { _id: string })._id] : [])) : []);
    // A replay is never executed again: its rows are read now, under the reader's current role view, and the
    // request's own load is checked again before anything leaves. A deleted row is gone.
    const rows = recorded?.op === 'delete' || first.table.model.select === false ? [] : await rowsNow(actor, first.loaded, tableId, ids, signal);
    for (const verify of first.loaded.fences) await verify();
    // The original count only under the authority it was decided under. After an access change, or from an older
    // receipt, a replay reports only what the reader sees now: the recorded ids currently visible, and no sign that
    // anything was left out.
    const same = !legacy && body[READ_SHAPE] === authorityShape(first.loaded.snapshot ? { role: first.loaded.snapshot.role ?? null, view: first.loaded.snapshot.view ?? null } : null);
    return { status: 200, body: bounded(same ? affected : rows.length, legacy ? [] : rows.map(sqlRow)) };
  }
  if (outcome.status < 400 || typeof outcome.body.message === 'string') return outcome;
  const why = outcome.body.error;
  if (why === 'idempotency_mismatch') return fail('validation_failed', 'this Idempotency-Key was already used for a different request');
  if (why === 'invalid_idempotency_key') return fail('validation_failed', 'the Idempotency-Key must be 16 to 128 letters, digits, - or _');
  if (why === 'operation_pending') return fail('outcome_unknown', 'a write with this Idempotency-Key is still running; retry the same request for its reply');
  return fail('outcome_unknown', 'this write has no confirmed reply; read the dataset before writing it again, and keep its Idempotency-Key');
}

/**
 * WRITES, with the policy checked on the EFFECT. A mutation runs against its
 * one loaded table; the engine's own temp triggers record what it actually
 * did, row by row (inserted, updated old→new, deleted — by rowid), and the
 * data policy is judged on that record, never on the statement's text:
 *
 *  - admission, from the authorizer's analysis: one write to the target,
 *    the operation and (for UPDATE) the assigned columns permitted, the
 *    functions allowed;
 *  - the row filter as row-level security: a row the filter does not admit
 *    is skipped by the trigger (RAISE(IGNORE)), exactly as if it were not
 *    there for the write, while reads inside the statement still see it;
 *  - INSERT columns: the columns an INSERT names are the ones whose DEFAULT
 *    was not taken (each DEFAULT is an engine function that counts itself);
 *  - presets on the written rows, then `check` on the result;
 *  - an effect outside the operation (REPLACE deleting a row, an UPDATE that
 *    moves a rowid) is refused.
 * `compilePolicyPredicate` emits the filter and check as SQL; its pattern operators call the library's
 * `like_matches`/`ilike_matches` (utils `datasetPatternMatch`, the matcher the app's role view uses too), and `_id`
 * reads the policy's `rowId` column.
 */
import type { ColumnType, DatasetColumn, DatasetMutationPolicy, DatasetOperation, DeletePermission, DryRunMutationsInput, DryRunMutationsResult, InsertPermission, MutationAnalysis, MutationInput, MutationOutcome, Row, RunInput, Scalar, StatementAnalysis, UpdatePermission } from '@artifactbin/contracts';
import { compilePolicyPredicate, policyValue } from '@artifactbin/utils/dataset-policy';
import { inferColumns } from '@artifactbin/utils/shape';
import { DEFAULT_CAPS } from '../caps';
import { SqliteDatabase, TimedOut, sqlValue, type Prepared } from './database';
import type { Sqlite3 } from './wasm';
import { preparedKey, type PreparedCache } from './prepared';
import { mountCatalog } from './reads';
import type { SqlExtensions } from '../extensions';

export interface WriteBounds { limit: number; timeoutMs: number }

class PolicyDenied extends Error {}
const refuse = (message: string): never => { throw new PolicyDenied(`Dataset policy: ${message}`); };
const quote = (name: string): string => `"${name.replaceAll('"', '""')}"`;
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e)).split('\n').slice(0, 3).join(' ').trim();
type Permission = InsertPermission | UpdatePermission | DeletePermission;

/** What the statement did, recorded by the engine's triggers while it ran. */
class Effect {
  readonly inserted: number[] = [];
  readonly updated: number[] = [];
  readonly deleted: number[] = [];
  moved = false;
  /** Rowids the policy filter admits; null when there is no filter. */
  visible: Set<number> | null = null;
  #recording = true;
  readonly #defaulted: number[];
  readonly unset: string;

  constructor(private readonly db: SqliteDatabase, private readonly target: string, columns: number) {
    this.#defaulted = Array.from({ length: columns }, () => 0);
    this.unset = db.internalFunction((i) => { if (this.#recording) this.#defaulted[Number(i)]!++; return null; }, 1);
  }

  /** Temp triggers on the target: a filter gate before UPDATE/DELETE, a recorder after each write. */
  install(): void {
    const skip = this.db.internalFunction((rowid) => (this.#recording && this.visible && !this.visible.has(Number(rowid)) ? 1 : 0), 1);
    const record = this.db.internalFunction((op, before, after) => {
      if (!this.#recording) return null;
      if (op === 'i') this.inserted.push(Number(after));
      else if (op === 'd') this.deleted.push(Number(before));
      else { this.updated.push(Number(before)); if (before !== after) this.moved = true; }
      return null;
    }, 3);
    const on = this.target;
    for (const body of [
      `BEFORE UPDATE ON ${on} WHEN ${skip}(OLD.rowid) BEGIN SELECT RAISE(IGNORE); END`,
      `BEFORE DELETE ON ${on} WHEN ${skip}(OLD.rowid) BEGIN SELECT RAISE(IGNORE); END`,
      `AFTER INSERT ON ${on} BEGIN SELECT ${record}('i', NULL, NEW.rowid); END`,
      `AFTER UPDATE ON ${on} BEGIN SELECT ${record}('u', OLD.rowid, NEW.rowid); END`,
      `AFTER DELETE ON ${on} BEGIN SELECT ${record}('d', OLD.rowid, NULL); END`,
    ]) this.db.exec(`CREATE TEMP TRIGGER ${this.db.internalName()} ${body}`);
  }

  /** The statement has finished: the engine's own follow-up writes are not part of its effect. */
  stop(): void { this.#recording = false; }

  /** Columns an INSERT named: those whose DEFAULT it never took. */
  named(names: string[]): string[] {
    return this.inserted.length ? names.filter((_, i) => this.#defaulted[i]! < this.inserted.length) : [];
  }

  /** Refuse any change outside the statement's own operation. */
  within(op: DatasetOperation): boolean {
    if (op === 'insert') return !this.updated.length && !this.deleted.length;
    if (op === 'update') return !this.inserted.length && !this.deleted.length && !this.moved;
    return !this.inserted.length && !this.updated.length;
  }
}

const bindOf = (params: Record<string, Scalar>): Record<string, string | number | null> =>
  Object.fromEntries(Object.entries(params).map(([k, v]) => [`$${k}`, sqlValue(undefined, v, k)]));

/** Admission by the analysis: operation, role, UPDATE columns, functions, reserved names. */
function admit(p: DatasetMutationPolicy, op: DatasetOperation, analysis: StatementAnalysis, names: string[], params: Record<string, Scalar>): Permission {
  if (!p.operations.includes(op)) refuse('operation is not permitted');
  const entries = p.table[`${op}_permissions`] as Array<{ role: string; permission: Permission }> | undefined;
  const permission = entries?.find((e) => e.role === p.role)?.permission ?? refuse('no matching role permission');
  // A backend_only entry is for the owner's programs (a verified saved document); generic callers never match it.
  if (permission.backend_only && !p.trusted) refuse('this operation is only available through the owner\'s page programs');
  if (names.some((n) => n.toLowerCase().startsWith('__policy_')) || Object.keys(params).some((n) => n.toLowerCase().startsWith('__policy_'))) refuse('reserved policy identifier');
  if (op === 'update') permitted(permission, analysis.writes[0]?.columns ?? []);
  const deny = new Set((p.execution?.functions?.deny ?? []).map((s) => s.toLowerCase()));
  const allow = p.execution?.functions?.allow?.map((s) => s.toLowerCase());
  for (const name of analysis.functions) {
    if (deny.has(name) || (allow && !allow.includes(name))) refuse(`function ${name} is not permitted`);
  }
  return permission;
}
function permitted(permission: Permission, written: string[]): void {
  if ('columns' in permission && permission.columns !== undefined && permission.columns !== '*' && written.some((c) => !permission.columns!.includes(c)))
    refuse('a written column is not permitted');
}

/**
 * One write. Over rows by value (`table.rows`, `reads`): its own throwaway database. Over keyed mounts
 * (`mounted`): the database `prepared` keeps for those keys (./prepared), the target swapped for its writable copy
 * inside a transaction that is always rolled back (`mountedMutation`).
 */
export function runMutation(sqlite3: Sqlite3, input: MutationInput, bounds: WriteBounds, extensions: SqlExtensions = {}, prepared?: PreparedCache): MutationOutcome {
  if (input.mounted) return mountedMutation(sqlite3, input, bounds, extensions, prepared);
  const db = new SqliteDatabase(sqlite3);
  try {
    return mutateIn(db, input, bounds, extensions, (spec, defaults) => {
      db.createTable(spec, defaults, true);
      db.insertRows(spec, input.table.rows);
      for (const read of input.reads ?? []) db.load(read);
    });
  } finally { db.close(); }
}

/**
 * A write over keyed mounts. Every table it reads is the prepared database's (built from `mounted.tables` on a miss,
 * and kept); the target, when mounted, is renamed out of reach (an unregistered name the guard refuses) and copied
 * inside SQLite into the writable target (its DEFAULTs, CHECKs and triggers), columns the catalog lacks NULL. All of
 * it runs in `scratchWrite`: rolled back, the engine's functions for it dropped, the database exactly as it was. A
 * composition with its own mutation setup installs functions on the database, so it never writes a kept one.
 */
function mountedMutation(sqlite3: Sqlite3, input: MutationInput, bounds: WriteBounds, extensions: SqlExtensions, prepared: PreparedCache | undefined): MutationOutcome {
  const mounted = input.mounted!;
  const run: RunInput = { catalog: mounted.catalog, tables: mounted.tables, queries: [{ name: 'mutation', sql: '' }], params: {} };
  const key = extensions.setupMutation ? null : preparedKey(run);
  let db = key ? prepared?.get(key) : undefined, owned = false;
  if (!db) {
    if (mounted.catalog.tables.some((t) => t.source !== undefined && !Object.hasOwn(mounted.tables, t.source))) return { error: 'the catalog rows are not prepared here: resend them with the keys', rowsRequired: true };
    db = new SqliteDatabase(sqlite3);
    try { mountCatalog(db, run); } catch (e) { db.close(); return { error: message(e) }; }
    owned = !(key && prepared?.keep(key, db));
  }
  const kept = db, schema = input.table.schema ?? 'main';
  const at = mounted.catalog.tables.find((t) => t.sql === undefined && t.schema.toLowerCase() === schema.toLowerCase() && t.name.toLowerCase() === input.table.name.toLowerCase());
  try {
    return kept.scratchWrite(() => mutateIn(kept, input, bounds, extensions, (spec, defaults) => {
      if (!at) { kept.createTable(spec, defaults, true); return; }
      const hold = kept.internalName();
      kept.exec(`ALTER TABLE ${quote(at.schema)}.${quote(at.name)} RENAME TO ${quote(hold)}`);
      kept.createTable(spec, defaults, true);
      const from = new Set(at.columns.map((c) => c.name));
      if (spec.columns.length) kept.exec(`INSERT INTO ${quote(spec.schema)}.${quote(spec.table)} (${spec.columns.map((c) => quote(c.name)).join(', ')}) SELECT ${spec.columns.map((c) => (from.has(c.name) ? quote(c.name) : 'NULL')).join(', ')} FROM ${quote(at.schema)}.${quote(hold)} ORDER BY rowid`);
    }));
  } finally { if (owned) kept.close(); }
}

function mutateIn(db: SqliteDatabase, input: MutationInput, bounds: WriteBounds, extensions: SqlExtensions, setup: (spec: { schema: string; table: string; columns: DatasetColumn[] }, defaults: (index: number) => string) => void): MutationOutcome {
  const started = performance.now();
  const remaining = () => Math.max(0, bounds.timeoutMs - (performance.now() - started));
  const columns: DatasetColumn[] = input.table.columns.length ? input.table.columns : inferColumns(input.table.rows);
  const names = columns.map((c) => c.name);
  const spec = { schema: input.table.schema ?? 'main', table: input.table.name, columns };
  const target = `${quote(spec.schema)}.${quote(spec.table)}`;
  const open: Prepared[] = [];
  let continuation: ReturnType<NonNullable<SqlExtensions['setupMutation']>> = undefined;
  try {
    // The effect is keyed by rowid, so a column may not shadow it.
    if (names.some((n) => /^(rowid|oid|_rowid_)$/i.test(n))) throw new Error(`a column named ${names.find((n) => /^(rowid|oid|_rowid_)$/i.test(n))} cannot be written by a <Mutation>`);
    continuation = extensions.setupMutation?.(db, { input, dryRun: false });
    const effect = new Effect(db, target, columns.length);
    setup(spec, (i) => `${effect.unset}(${i})`);
    effect.install();

    const statement = db.prepare(input.sql, 'write', spec);
    open.push(statement);
    const op = statement.analysis.kind as DatasetOperation;
    const p = input.policy;
    const permission = p ? admit(p, op, statement.analysis, names, input.params) : null;
    if (p && permission && 'filter' in permission) {
      const filter = compilePolicyPredicate(permission.filter, names, p.session, '__policy_filter', { rowId: p.rowId });
      effect.visible = new Set(db.exec(`SELECT rowid AS id FROM ${target} WHERE ${filter.sql}`, bindOf(filter.params)).map((r) => Number(r.id)));
    }
    // Row identity by rowid before the statement runs (a deleted row's identity is gone afterwards; UPDATE never moves a rowid).
    const identity = input.identity && names.includes(input.identity) ? input.identity : null;
    const identities = identity ? new Map(db.exec(`SELECT rowid AS id, ${quote(identity)} AS v FROM ${target}`).map((r) => [Number(r.id), r.v as Scalar])) : null;
    statement.bind(input.params, input.paramTypes).run(remaining());
    effect.stop();
    if (!effect.within(op)) {
      const why = `the ${op.toUpperCase()} changed rows outside its own operation (a REPLACE, or a changed rowid) — not supported`;
      if (p) refuse(why);
      throw new Error(why);
    }
    const written = op === 'insert' ? effect.named(names) : op === 'update' ? statement.analysis.writes[0]?.columns ?? [] : [];
    const analysis: MutationAnalysis = { operation: op, columns: written, functions: statement.analysis.functions };
    if (p && permission && op === 'insert') permitted(permission, written);
    if (p && input.policyPreview) return { rows: input.table.rows, columns, affected: 0, analysis };

    const ids = JSON.stringify(op === 'insert' ? effect.inserted : effect.updated);
    // What the target's CHECKs accepted (a timestamp in a date column…), stored canonically before presets and the check.
    if (op !== 'delete') db.normalize(spec, ids);
    const writtenRows = 'rowid IN (SELECT value FROM json_each($__policy_ids))';
    const presets = p && permission && 'set' in permission && permission.set ? Object.entries(permission.set) : [];
    if (presets.length) {
      const bind: Record<string, string | number | null> = { $__policy_ids: ids };
      const sets = presets.map(([name, v], i) => {
        const column = columns.find((c) => c.name === name) ?? refuse('unknown preset column');
        bind[`$__policy_set_${i}`] = sqlValue(column.type, policyValue(v, p!.session), `preset ${name}`);
        return `${quote(name)} = $__policy_set_${i}`;
      });
      db.exec(`UPDATE ${target} SET ${sets.join(', ')} WHERE ${writtenRows}`, bind);
    }
    if (p && permission && 'check' in permission && permission.check && op !== 'delete') {
      const check = compilePolicyPredicate(permission.check, names, p.session, '__policy_check', { rowId: p.rowId });
      const [failed] = db.exec(`SELECT count(*) AS n FROM ${target} WHERE ${writtenRows} AND (${check.sql}) IS NOT TRUE`, { ...bindOf(check.params), $__policy_ids: ids });
      if (Number(failed?.n)) refuse('a resulting row failed its check');
    }
    const affected = op === 'insert' ? effect.inserted.length : op === 'update' ? effect.updated.length : effect.deleted.length;
    // Assigned user fields, presets included, for the app to validate before it commits.
    const assigned = new Set([...written, ...presets.map(([name]) => name)]);
    const users = op === 'delete' ? [] : columns.filter((c) => c.type === 'user' && assigned.has(c.name));
    const userWrites: Row[] = users.length ? db.exec(`SELECT ${users.map((c) => quote(c.name)).join(', ')} FROM ${target} WHERE ${writtenRows}`, { $__policy_ids: ids }) : [];
    let touched: Scalar[] | undefined;
    if (identity && identities) {
      const rowids = [...new Set(op === 'insert' ? effect.inserted : op === 'update' ? effect.updated : effect.deleted)].sort((a, b) => a - b);
      const inserted = op === 'insert' ? new Map(db.exec(`SELECT rowid AS id, ${quote(identity)} AS v FROM ${target} WHERE ${writtenRows}`, { $__policy_ids: JSON.stringify(rowids) }).map((r) => [Number(r.id), r.v as Scalar])) : identities;
      touched = rowids.map((id) => inserted.get(id) ?? null);
    }
    const applied = { ...(p || columns.some((c) => c.type === 'user') ? { affected, analysis, userWrites } : { affected }), ...(touched ? { written: touched } : {}) };

    if (input.expectedAffected !== undefined && affected !== input.expectedAffected) {
      if (affected === 0) return { error: 'the row changed since it was read', code: 'row_changed' };
      if (affected > input.expectedAffected) return { error: `the mutation matched ${affected} rows; expected ${input.expectedAffected}`, code: 'row_not_unique' };
      return { error: `the mutation changed ${affected} rows; expected ${input.expectedAffected}`, code: 'row_changed' };
    }
    const pending = continuation?.();
    if (pending) return { error: 'Execution requires continuation', continuation: pending };
    if (input.answer === 'written') {
      const [count] = db.exec(`SELECT count(*) AS n FROM ${target}`);
      if (Number(count?.n) > bounds.limit) return { error: `this write would leave ${Number(count?.n)} rows, over the dataset cap of ${bounds.limit} rows — delete rows first, or keep the dataset under the cap`, full: true };
      if (op === 'delete') return { rows: [], columns: input.table.columns, ...applied };
      // Only the rows it wrote, as they are now, in rowid order.
      const own = db.prepare(`SELECT * FROM ${target} WHERE rowid IN (SELECT value FROM json_each($written)) ORDER BY rowid`, 'read');
      open.push(own);
      return { rows: own.bind({ written: ids }).rows(Number.POSITIVE_INFINITY, remaining()).rows, columns: input.table.columns, ...applied };
    }
    // The table as it is now, read one row past the cap: a write that would leave too many rows is refused whole.
    const after = db.prepare(`SELECT * FROM ${target}`, 'read');
    open.push(after);
    const { rows, more } = after.rows(bounds.limit, remaining());
    if (more) {
      const [count] = db.exec(`SELECT count(*) AS n FROM ${target}`);
      return { error: `this write would leave ${Number(count?.n)} rows, over the dataset cap of ${bounds.limit} rows — delete rows first, or keep the dataset under the cap`, full: true };
    }
    return { rows, columns: input.table.columns, ...applied };
  } catch (e) {
    if (e instanceof TimedOut) return { error: `the mutation ran too long and was stopped (limit ${bounds.timeoutMs}ms)`, timedOut: true };
    if (e instanceof PolicyDenied) return { error: e.message, code: 'policy_denied' };
    // An extension may abort the statement to demand an external result: the demand, not the abort, is the answer.
    const pending = continuation?.();
    if (pending) return { error: 'Execution requires continuation', continuation: pending };
    return { error: message(e) };
  } finally {
    for (const p of open) p.finalize();
  }
}

/**
 * Publish-time twin of `runMutation`: each mutation prepared, bound with
 * typed NULLs and run against its own EMPTY target — exactly the world a
 * click sees, so "no such table" here is the message a click would produce.
 */
export function dryRunMutations(sqlite3: Sqlite3, input: DryRunMutationsInput, extensions: SqlExtensions = {}): DryRunMutationsResult {
  const errors: DryRunMutationsResult['errors'] = [];
  const params = Object.fromEntries(input.paramNames.map((p) => [p, null]));
  for (const m of input.mutations) {
    const db = new SqliteDatabase(sqlite3);
    let statement: Prepared | null = null;
    try {
      extensions.setupMutation?.(db, { dryRun: true });
      const table = m.tableName ?? `ref_${m.target}`;
      const target = input.tables[table];
      if (target) db.createTable({ schema: 'main', table, columns: target.columns }, undefined, true);
      statement = db.prepare(m.sql, 'write', { schema: 'main', table });
      statement.bind(params, { ...input.paramTypes, ...m.paramTypes } as Record<string, ColumnType>).run(DEFAULT_CAPS.timeoutMs);
    } catch (e) {
      errors.push({ name: m.name, error: message(e) });
    } finally {
      statement?.finalize();
      db.close();
    }
  }
  return { errors };
}

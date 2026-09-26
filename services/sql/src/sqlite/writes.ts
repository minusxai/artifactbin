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
 * `compilePolicyPredicate` emits the portable SQL both engines evaluate.
 */
import type { ColumnType, DatasetColumn, DatasetMutationPolicy, DatasetOperation, DeletePermission, DryRunMutationsInput, DryRunMutationsResult, InsertPermission, MutationAnalysis, MutationInput, MutationOutcome, Row, Scalar, StatementAnalysis, UpdatePermission } from '@artifactbin/contracts';
import { compilePolicyPredicate, policyValue } from '@artifactbin/utils/dataset-policy';
import { inferColumns } from '@artifactbin/utils/shape';
import { DEFAULT_CAPS } from '../caps';
import { SqliteDatabase, TimedOut, sqlValue, type Prepared } from './database';
import type { Sqlite3 } from './wasm';
import type { SqlExtensions } from '../extensions';

export interface WriteBounds { limit: number; timeoutMs: number }

export class PolicyDenied extends Error {}
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

export function runMutation(sqlite3: Sqlite3, input: MutationInput, bounds: WriteBounds, extensions: SqlExtensions = {}): MutationOutcome {
  const started = performance.now();
  const remaining = () => Math.max(0, bounds.timeoutMs - (performance.now() - started));
  const columns: DatasetColumn[] = input.table.columns.length ? input.table.columns : inferColumns(input.table.rows);
  const names = columns.map((c) => c.name);
  const spec = { schema: input.table.schema ?? 'main', table: input.table.name, columns };
  const target = `${quote(spec.schema)}.${quote(spec.table)}`;
  const db = new SqliteDatabase(sqlite3);
  const open: Prepared[] = [];
  let continuation: ReturnType<NonNullable<SqlExtensions['setupMutation']>> = undefined;
  try {
    // The effect is keyed by rowid, so a column may not shadow it.
    if (names.some((n) => /^(rowid|oid|_rowid_)$/i.test(n))) throw new Error(`a column named ${names.find((n) => /^(rowid|oid|_rowid_)$/i.test(n))} cannot be written by a <Mutation>`);
    continuation = extensions.setupMutation?.(db, { input, dryRun: false });
    const effect = new Effect(db, target, columns.length);
    db.createTable(spec, (i) => `${effect.unset}(${i})`);
    db.insertRows(spec, input.table.rows);
    for (const read of input.reads ?? []) db.load(read);
    effect.install();

    const statement = db.prepare(input.sql, 'write', spec);
    open.push(statement);
    const op = statement.analysis.kind as DatasetOperation;
    const p = input.policy;
    const permission = p ? admit(p, op, statement.analysis, names, input.params) : null;
    if (p && permission && 'filter' in permission) {
      const filter = compilePolicyPredicate(permission.filter, names, p.session, '__policy_filter');
      effect.visible = new Set(db.exec(`SELECT rowid AS id FROM ${target} WHERE ${filter.sql}`, bindOf(filter.params)).map((r) => Number(r.id)));
    }
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
      const check = compilePolicyPredicate(permission.check, names, p.session, '__policy_check');
      const [failed] = db.exec(`SELECT count(*) AS n FROM ${target} WHERE ${writtenRows} AND (${check.sql}) IS NOT TRUE`, { ...bindOf(check.params), $__policy_ids: ids });
      if (Number(failed?.n)) refuse('a resulting row failed its check');
    }
    const affected = op === 'insert' ? effect.inserted.length : op === 'update' ? effect.updated.length : effect.deleted.length;
    // Assigned user fields, presets included, for the app to validate before it commits.
    const assigned = new Set([...written, ...presets.map(([name]) => name)]);
    const users = op === 'delete' ? [] : columns.filter((c) => c.type === 'user' && assigned.has(c.name));
    const userWrites: Row[] = users.length ? db.exec(`SELECT ${users.map((c) => quote(c.name)).join(', ')} FROM ${target} WHERE ${writtenRows}`, { $__policy_ids: ids }) : [];
    const applied = p || columns.some((c) => c.type === 'user') ? { affected, analysis, userWrites } : { affected };

    if (input.expectedAffected !== undefined && affected !== input.expectedAffected) {
      if (affected === 0) return { error: 'the row changed since it was read', code: 'row_changed' };
      if (affected > input.expectedAffected) return { error: `the mutation matched ${affected} rows; expected ${input.expectedAffected}`, code: 'row_not_unique' };
      return { error: `the mutation changed ${affected} rows; expected ${input.expectedAffected}`, code: 'row_changed' };
    }
    const pending = continuation?.();
    if (pending) return { error: 'Execution requires continuation', continuation: pending };
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
    db.close();
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
      if (target) db.createTable({ schema: 'main', table, columns: target.columns });
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

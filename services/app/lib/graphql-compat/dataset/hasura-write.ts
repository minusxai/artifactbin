/** DEPRECATED: GraphQL compatibility for pages published before SQL. Do not use in new code; do not extend. */
/**
 * THE MUTATION COMPILER: one generated mutation field (`insert_<root>`, `update_<root>_by_pk`…) to one
 * row-addressed engine statement over the stored table. The statement is the caller's request only: the
 * write path (lib/document-data `mutateDataset`) runs it under the role's rule, so the engine enforces the
 * rule's columns, its filter as row-level security, its presets and its check on the effect, and the commit
 * decides again under the row lock.
 *
 *  - Values are bound parameters; identifiers are the rule's writable source columns, looked up again by
 *    GraphQL name (defence in depth behind schema validation), quoted.
 *  - `_id` is generated (`id(index)`, deterministic per idempotency key so a retry or replay inserts the same
 *    rows) and is never a writable field. One `insert_<root>` is one multi-row INSERT naming the union of its
 *    objects' columns (an absent column is NULL, as its default would be; presets and the check run after).
 *  - `where` compiles exactly as in reads (./hasura-read), over `_id` and the selectable columns only.
 *  - `_inc` adds to the stored value (NULL stays NULL, as in Postgres); a column is either set or incremented.
 */
import { DATASET_GRAPHQL_WRITE_LIMITS, type Scalar } from '@artifactbin/contracts';
import { ID_COLUMN, quote } from '../../dataset-access/model';
import { summable, type HasuraColumn, type HasuraTableModel } from './hasura-schema';
import { compileWhere, HasuraReadError } from './hasura-read';
import type { DatasetStatement } from '@/lib/dataset-access';

/** A refusal the caller can fix, its message free of row data. */
export class HasuraWriteError extends Error {
  constructor(readonly code: 'validation_failed' | 'too_many_rows', message: string) { super(message); }
}
const refuse = (message: string, code: HasuraWriteError['code'] = 'validation_failed'): never => { throw new HasuraWriteError(code, message); };

export type HasuraMutationKind = 'insert' | 'insert_one' | 'update' | 'update_by_pk' | 'delete' | 'delete_by_pk';

/** Every generated mutation root field → its table model and kind, for the rules each model has. */
export function mutationRoots(models: readonly HasuraTableModel[]): Map<string, { model: HasuraTableModel; kind: HasuraMutationKind }> {
  const out = new Map<string, { model: HasuraTableModel; kind: HasuraMutationKind }>();
  for (const model of models) {
    const r = model.root, one = model.select !== false, w = model.write ?? {};
    const add = (field: string, kind: HasuraMutationKind) => out.set(field, { model, kind });
    if (w.insert?.length) { add(`insert_${r}`, 'insert'); if (one) add(`insert_${r}_one`, 'insert_one'); }
    if (w.update?.length) { add(`update_${r}`, 'update'); if (one) add(`update_${r}_by_pk`, 'update_by_pk'); }
    if (w.delete) { add(`delete_${r}`, 'delete'); if (one) add(`delete_${r}_by_pk`, 'delete_by_pk'); }
  }
  return out;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const target = (t: HasuraTableModel) => `${quote(t.table.schema)}.${quote(t.table.name)}`;

function value(c: HasuraColumn, v: unknown): Scalar {
  if (v === null) return null;
  const ok = c.type === 'Float' ? typeof v === 'number' && Number.isFinite(v) : c.type === 'Boolean' ? typeof v === 'boolean' : typeof v === 'string';
  return ok ? v as Scalar : refuse(`${c.field} takes a ${c.type}`);
}

/** The input's fields as writable columns (in the model's column order), refusing any other field. */
function fields(columns: readonly HasuraColumn[], input: unknown, type: string): Array<[HasuraColumn, unknown]> {
  if (!isObject(input)) refuse(`${type} must be an object`);
  const entries = Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== undefined);
  for (const [field] of entries) if (!columns.some((c) => c.field === field)) refuse(`${type} has no field ${field}`);
  return columns.filter((c) => entries.some(([f]) => f === c.field)).map((c) => [c, (input as Record<string, unknown>)[c.field]]);
}

function where(t: HasuraTableModel, exp: unknown, params: Record<string, unknown>): string {
  if (exp === undefined || exp === null) refuse('where is required');
  try { return compileWhere(t, exp, params); } catch (e) { if (e instanceof HasuraReadError) refuse(e.message); throw e; }
}

function pk(args: Record<string, unknown>, kind: HasuraMutationKind): string {
  const id = kind === 'update_by_pk' ? (isObject(args.pk_columns) ? args.pk_columns._id : undefined) : args._id;
  return typeof id === 'string' && id ? id : refuse('_id must be a row ID');
}

function insert(t: HasuraTableModel, objects: unknown[], id: (index: number) => string): DatasetStatement | null {
  if (objects.length > DATASET_GRAPHQL_WRITE_LIMITS.objects) refuse(`an insert takes at most ${DATASET_GRAPHQL_WRITE_LIMITS.objects} objects`, 'too_many_rows');
  if (!objects.length) return null;
  const writable = t.write?.insert ?? [];
  const rows = objects.map((o) => fields(writable, o, `${t.root}_insert_input`));
  const named = writable.filter((c) => rows.some((row) => row.some(([col]) => col === c)));
  const params: Record<string, Scalar> = {};
  const values = rows.map((row, i) => {
    const slots = named.map((c, j) => {
      const found = row.find(([col]) => col === c);
      params[`v${i}_${j}`] = found ? value(c, found[1]) : null;
      return `$v${i}_${j}`;
    });
    params[`id${i}`] = id(i);
    return `(${[...slots, `$id${i}`].join(', ')})`;
  });
  return { sql: `INSERT INTO ${target(t)} (${[...named.map((c) => c.source), ID_COLUMN].map(quote).join(', ')}) VALUES ${values.join(', ')}`, params };
}

function update(t: HasuraTableModel, kind: HasuraMutationKind, args: Record<string, unknown>): DatasetStatement {
  const writable = t.write?.update ?? [];
  const set = args._set === undefined || args._set === null ? [] : fields(writable, args._set, `${t.root}_set_input`);
  const inc = args._inc === undefined || args._inc === null ? [] : fields(writable.filter(summable), args._inc, `${t.root}_inc_input`);
  if (!set.length && !inc.length) refuse('an update needs _set or _inc');
  if (set.some(([c]) => inc.some(([d]) => c === d))) refuse('a column cannot be both set and incremented');
  const params: Record<string, Scalar> = {};
  const assignments = [
    ...set.map(([c, v], i) => { params[`s${i}`] = value(c, v); return `${quote(c.source)} = $s${i}`; }),
    ...inc.map(([c, v], i) => { params[`i${i}`] = v === null ? refuse(`_inc ${c.field} takes a number`) : value(c, v); return `${quote(c.source)} = ${quote(c.source)} + $i${i}`; }),
  ];
  const condition = kind === 'update_by_pk' ? (params.pk = pk(args, kind), `${quote(ID_COLUMN)} = $pk`) : where(t, args.where, params);
  return { sql: `UPDATE ${target(t)} SET ${assignments.join(', ')} WHERE ${condition}`, params };
}

/**
 * One field's statement, or null when it writes nothing (`insert_<root>(objects: [])`). `id(i)` names the
 * i-th inserted row. Throws HasuraWriteError for a request the caller can fix.
 */
export function compileMutation(t: HasuraTableModel, kind: HasuraMutationKind, args: Record<string, unknown>, id: (index: number) => string): DatasetStatement | null {
  switch (kind) {
    case 'insert': return insert(t, Array.isArray(args.objects) ? args.objects : refuse('objects must be a list'), id);
    case 'insert_one': return insert(t, [args.object], id);
    case 'update': case 'update_by_pk': return update(t, kind, args);
    case 'delete': { const params: Record<string, Scalar> = {}; const condition = where(t, args.where, params); return { sql: `DELETE FROM ${target(t)} WHERE ${condition}`, params }; }
    case 'delete_by_pk': return { sql: `DELETE FROM ${target(t)} WHERE ${quote(ID_COLUMN)} = $pk`, params: { pk: pk(args, kind) } };
  }
}

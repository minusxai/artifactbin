/**
 * THE READ COMPILER: generated GraphQL arguments (`where`, `order_by`, `limit`, `offset`) to one engine
 * statement over the role view's table. The statement never reaches stored rows itself: the executor mounts
 * the role view (lib/dataset-permissions) as the table, so the select rule's filter, columns and limit hold
 * before any of this runs, and a `where` here only narrows further.
 *
 *  - Values are bound parameters (`$w0`…); identifiers are the role's visible source columns, looked up again
 *    by GraphQL name (defence in depth behind schema validation), quoted.
 *  - SQLite semantics are pinned to Hasura's (Postgres): `_like` is case-sensitive (compiled to GLOB),
 *    `_ilike` is `LIKE … ESCAPE '\'` (ASCII case folding), `asc` sorts nulls last and `desc` nulls first.
 *  - `_id asc` is always the final ordering, so offset paging is deterministic.
 *  - A null operand is refused (use `_is_null`); empty `_and` is true, empty `_or` false, `{}` true.
 */
import { DATASET_GRAPHQL_READ_LIMITS, DATASET_PERMISSION_LIMITS, type Scalar } from '@artifactbin/contracts';
import { ID_COLUMN, quote } from './model';
import { operatorsFor, orderable, summable, type HasuraColumn, type HasuraTableModel } from './hasura-schema';
import type { DatasetStatement } from './types';

/** A refusal the caller can fix: answered as `validation_failed`, its message free of row data. */
export class HasuraReadError extends Error {
  readonly code = 'validation_failed';
}
const refuse = (message: string): never => { throw new HasuraReadError(message); };

export interface HasuraReadArgs {
  where?: unknown;
  order_by?: unknown;
  limit?: unknown;
  offset?: unknown;
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const ID: HasuraColumn = { field: '_id', source: ID_COLUMN, type: 'String' };
function column(t: HasuraTableModel, field: string): HasuraColumn {
  if (field === '_id') return ID;
  return t.columns.find((c) => c.field === field) ?? refuse(`unknown column "${field}" on ${t.root}`);
}

/** A LIKE pattern (`%`, `_`, `\` escapes) as a GLOB pattern: case-sensitive, literal `*?[` bracketed. */
function globOf(pattern: string): string {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    const literal = c === '\\' && i + 1 < pattern.length ? pattern[++i]! : null;
    const ch = literal ?? c;
    if (literal === null && c === '%') out += '*';
    else if (literal === null && c === '_') out += '?';
    else if (ch === '*' || ch === '?' || ch === '[') out += `[${ch}]`;
    else out += ch;
  }
  return out;
}

interface Budget { predicates: number }
class WhereCompiler {
  private n = 0;
  private budget: Budget = { predicates: 0 };
  constructor(private readonly t: HasuraTableModel, private readonly params: Record<string, unknown>) {}

  private bind(value: unknown): string {
    if (value === null || value === undefined) refuse('a comparison value cannot be null; use _is_null');
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') refuse('a comparison value must be a scalar');
    if (typeof value === 'number' && !Number.isFinite(value)) refuse('a comparison value must be finite');
    const name = `w${this.n++}`;
    this.params[name] = value;
    return `$${name}`;
  }

  exp(exp: unknown, depth: number): string {
    if (depth > DATASET_PERMISSION_LIMITS.depth) refuse(`where is nested deeper than ${DATASET_PERMISSION_LIMITS.depth}`);
    if (!isObject(exp)) refuse('where must be an object');
    const parts: string[] = [];
    for (const [key, value] of Object.entries(exp as Record<string, unknown>)) {
      if (value === undefined) continue;
      if (key === '_and' || key === '_or') {
        if (!Array.isArray(value)) refuse(`${key} takes a list`);
        const items = (value as unknown[]).map((item) => this.exp(item, depth + 1));
        parts.push(items.length ? `(${items.join(key === '_and' ? ' AND ' : ' OR ')})` : key === '_and' ? '(1=1)' : '(1=0)');
      } else if (key === '_not') {
        parts.push(`(NOT ${this.exp(value, depth + 1)})`);
      } else {
        parts.push(this.comparison(column(this.t, key), value));
      }
    }
    return parts.length ? `(${parts.join(' AND ')})` : '(1=1)';
  }

  private comparison(c: HasuraColumn, ops: unknown): string {
    if (!isObject(ops)) refuse(`${c.field} takes a comparison object`);
    const allowed = operatorsFor(c === ID ? 'ID' : c.type), q = quote(c.source);
    const parts: string[] = [];
    for (const [op, value] of Object.entries(ops as Record<string, unknown>)) {
      if (value === undefined) continue;
      if (!allowed.includes(op)) refuse(`${c.field} has no operator ${op}`);
      if (++this.budget.predicates > DATASET_PERMISSION_LIMITS.predicates) refuse(`where has more than ${DATASET_PERMISSION_LIMITS.predicates} predicates`);
      switch (op) {
        case '_eq': parts.push(`${q} = ${this.bind(value)}`); break;
        case '_neq': parts.push(`${q} <> ${this.bind(value)}`); break;
        case '_gt': parts.push(`${q} > ${this.bind(value)}`); break;
        case '_gte': parts.push(`${q} >= ${this.bind(value)}`); break;
        case '_lt': parts.push(`${q} < ${this.bind(value)}`); break;
        case '_lte': parts.push(`${q} <= ${this.bind(value)}`); break;
        case '_in': case '_nin': {
          if (!Array.isArray(value)) refuse(`${op} takes a list`);
          const list = value as unknown[];
          if (list.length > DATASET_PERMISSION_LIMITS.inValues) refuse(`${op} takes at most ${DATASET_PERMISSION_LIMITS.inValues} values`);
          if (!list.length) parts.push(op === '_in' ? '(1=0)' : '(1=1)');
          else parts.push(`${q} ${op === '_in' ? 'IN' : 'NOT IN'} (${list.map((v) => this.bind(v)).join(', ')})`);
          break;
        }
        case '_is_null':
          if (typeof value !== 'boolean') refuse('_is_null takes true or false');
          parts.push(`${q} IS ${value ? '' : 'NOT '}NULL`);
          break;
        case '_like': case '_nlike': {
          if (typeof value !== 'string') refuse(`${op} takes a string`);
          const match = `${q} GLOB ${this.bind(globOf(value as string))}`;
          parts.push(op === '_like' ? match : `NOT (${match})`);
          break;
        }
        case '_ilike': case '_nilike': {
          if (typeof value !== 'string') refuse(`${op} takes a string`);
          const match = `${q} LIKE ${this.bind(value)} ESCAPE '\\'`;
          parts.push(op === '_ilike' ? match : `NOT (${match})`);
          break;
        }
        default: refuse(`${c.field} has no operator ${op}`);
      }
    }
    return `(${parts.length ? parts.join(' AND ') : '1=1'})`;
  }
}

/** The `where` as one SQL condition; its values land in `params`. */
export function compileWhere(t: HasuraTableModel, where: unknown, params: Record<string, unknown>): string {
  return new WhereCompiler(t, params).exp(where ?? {}, 0);
}

const DIRECTIONS: Record<string, string> = {
  asc: 'ASC NULLS LAST', asc_nulls_last: 'ASC NULLS LAST', asc_nulls_first: 'ASC NULLS FIRST',
  desc: 'DESC NULLS FIRST', desc_nulls_first: 'DESC NULLS FIRST', desc_nulls_last: 'DESC NULLS LAST',
};
function compileOrder(t: HasuraTableModel, orderBy: unknown): string[] {
  if (orderBy === undefined || orderBy === null) return [];
  const items = Array.isArray(orderBy) ? orderBy : [orderBy];
  if (items.length > 16) refuse('order_by takes at most 16 items');
  return items.flatMap((item) => {
    if (!isObject(item)) refuse('order_by takes objects');
    return Object.entries(item).filter(([, d]) => d !== undefined && d !== null).map(([field, direction]) => {
      const sql = DIRECTIONS[String(direction)] ?? refuse(`unknown order ${String(direction)}`);
      return `${quote(column(t, field).source)} ${sql}`;
    });
  });
}

function nonNegative(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) refuse(`${name} must be a non-negative integer`);
  return value as number;
}

const from = (t: HasuraTableModel) => `${quote(t.table.schema)}.${quote(t.table.name)}`;
function filtered(t: HasuraTableModel, args: HasuraReadArgs, params: Record<string, unknown>): string {
  return args.where === undefined || args.where === null ? '' : ` WHERE ${compileWhere(t, args.where, params)}`;
}

export interface HasuraRowsPlan { statement: DatasetStatement; window: { limit: number; offset: number } }

/**
 * A list field (or `_by_pk`, or an aggregate's `nodes`): `_id` and every visible column, under their GraphQL
 * names. The window is `limit` (default 100) cut to 1000 and the select rule's limit, from `offset`.
 */
export function compileRows(t: HasuraTableModel, args: HasuraReadArgs): HasuraRowsPlan {
  const params: Record<string, unknown> = {};
  const select = [`${quote(ID_COLUMN)} AS ${quote('_id')}`, ...t.columns.map((c) => `${quote(c.source)} AS ${quote(c.field)}`)];
  const order = [...compileOrder(t, args.order_by), `${quote(ID_COLUMN)} ASC`];
  const sql = `SELECT ${select.join(', ')} FROM ${from(t)}${filtered(t, args, params)} ORDER BY ${order.join(', ')}`;
  const limit = Math.min(nonNegative(args.limit, 'limit') ?? DATASET_GRAPHQL_READ_LIMITS.defaultLimit, DATASET_GRAPHQL_READ_LIMITS.maxLimit, t.limit ?? Number.POSITIVE_INFINITY);
  return { statement: { sql, params: params as Record<string, Scalar> }, window: { limit, offset: nonNegative(args.offset, 'offset') ?? 0 } };
}

export type HasuraAggregate =
  | { kind: 'count'; columns?: readonly string[]; distinct?: boolean }
  | { kind: 'sum' | 'avg' | 'min' | 'max' };

/**
 * One aggregate over the rows the same arguments select (the whole filtered view when no `limit` is given:
 * aggregates count every visible row). `count` answers column `value`; `sum`/`avg`/`min`/`max` answer one
 * column per eligible visible field.
 */
export function compileAggregate(t: HasuraTableModel, args: HasuraReadArgs, aggregate: HasuraAggregate): DatasetStatement {
  const params: Record<string, unknown> = {};
  const limit = nonNegative(args.limit, 'limit'), offset = nonNegative(args.offset, 'offset');
  const order = compileOrder(t, args.order_by);
  const windowed = limit !== undefined || offset !== undefined;
  const ordering = order.length || windowed ? ` ORDER BY ${[...order, `${quote(ID_COLUMN)} ASC`].join(', ')}` : '';
  const window = windowed ? ` LIMIT ${limit ?? -1} OFFSET ${offset ?? 0}` : '';
  const inner = `SELECT * FROM ${from(t)}${filtered(t, args, params)}${ordering}${window}`;
  let select: string;
  if (aggregate.kind === 'count') {
    const columns = (aggregate.columns ?? []).map((field) => (field === '_id' ? refuse('count takes visible columns') : column(t, field)));
    const expr = !columns.length ? '*'
      : columns.length === 1 ? `${aggregate.distinct ? 'DISTINCT ' : ''}${quote(columns[0]!.source)}`
      : aggregate.distinct ? `DISTINCT json_array(${columns.map((c) => quote(c.source)).join(', ')})` : '*';
    select = `COUNT(${expr}) AS ${quote('value')}`;
  } else {
    const eligible = t.columns.filter(aggregate.kind === 'sum' || aggregate.kind === 'avg' ? summable : orderable);
    if (!eligible.length) refuse(`${t.root} has no columns for ${aggregate.kind}`);
    select = eligible.map((c) => `${aggregate.kind.toUpperCase()}(${quote(c.source)}) AS ${quote(c.field)}`).join(', ');
  }
  return { sql: `SELECT ${select} FROM (${inner}) AS af_hasura`, params: params as Record<string, Scalar> };
}

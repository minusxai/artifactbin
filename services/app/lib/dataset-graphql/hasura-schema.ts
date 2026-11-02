/**
 * THE GENERATED READ SCHEMA (Hasura v2 subset) for one caller's role. The model holds only what the role may
 * select: a hidden column is in no type (row, bool_exp, order_by, select_column, aggregate fields), so it
 * cannot be read, filtered, sorted, aggregated or introspected; a table the role cannot select has no model.
 * `<root>_aggregate` exists only when the select rule has `allow_aggregations`. Shared input types come once
 * from the prelude. The query root is the only root (mutations arrive with PR 5).
 */
import { DATASET_COLUMN_OPERATORS, DATASET_ID_OPERATORS, type DatasetColumnOperator, type DatasetTableName } from '@artifactbin/contracts';

export type HasuraScalar = 'String' | 'Float' | 'Boolean';
export interface HasuraColumn {
  /** The GraphQL field name (lib/dataset-graphql/hasura-names). */
  field: string;
  /** The stored source column it reads. */
  source: string;
  type: HasuraScalar;
}
export interface HasuraTableModel {
  root: string;
  /** The engine table the reads compile against. */
  table: DatasetTableName;
  /** The columns the role may select, in declared order. */
  columns: readonly HasuraColumn[];
  aggregations: boolean;
  /** The select rule's row limit, when it has one. */
  limit?: number;
}

const LIKE = new Set<DatasetColumnOperator>(['_like', '_nlike', '_ilike', '_nilike']);
/** Operators per scalar: the plan's list, pattern operators for strings only. */
export function operatorsFor(type: HasuraScalar | 'ID'): readonly string[] {
  if (type === 'ID') return DATASET_ID_OPERATORS;
  return DATASET_COLUMN_OPERATORS.filter((op) => type === 'String' || !LIKE.has(op));
}
function comparison(type: HasuraScalar | 'ID'): string {
  const fields = operatorsFor(type).map((op) => `${op}: ${op === '_is_null' ? 'Boolean' : op === '_in' || op === '_nin' ? `[${type}!]` : type}`);
  return `input ${type}_comparison_exp { ${fields.join(' ')} }`;
}

const ORDER_BY = ['asc', 'asc_nulls_first', 'asc_nulls_last', 'desc', 'desc_nulls_first', 'desc_nulls_last'] as const;
const PRELUDE = [
  `enum order_by { ${ORDER_BY.join(' ')} }`,
  comparison('ID'),
  comparison('String'),
  comparison('Float'),
  comparison('Boolean'),
];

/** Columns `sum`/`avg` take (numeric) and `min`/`max` take (numeric or string). */
export const summable = (c: HasuraColumn) => c.type === 'Float';
export const orderable = (c: HasuraColumn) => c.type === 'Float' || c.type === 'String';

function tableTypes(t: HasuraTableModel): string[] {
  const r = t.root;
  const list = (items: string[]) => items.join(' ');
  const out = [
    `type ${r} { ${list(['_id: ID!', ...t.columns.map((c) => `${c.field}: ${c.type}`)])} }`,
    `input ${r}_bool_exp { ${list([`_and: [${r}_bool_exp!]`, `_or: [${r}_bool_exp!]`, `_not: ${r}_bool_exp`, '_id: ID_comparison_exp', ...t.columns.map((c) => `${c.field}: ${c.type}_comparison_exp`)])} }`,
    `input ${r}_order_by { ${list(['_id: order_by', ...t.columns.map((c) => `${c.field}: order_by`)])} }`,
  ];
  if (!t.aggregations) return out;
  if (t.columns.length) out.push(`enum ${r}_select_column { ${list(t.columns.map((c) => c.field))} }`);
  out.push(`type ${r}_aggregate { aggregate: ${r}_aggregate_fields nodes: [${r}!]! }`);
  const sums = t.columns.filter(summable), extremes = t.columns.filter(orderable);
  const fields = [`count${t.columns.length ? `(columns: [${r}_select_column!], distinct: Boolean)` : ''}: Int!`];
  if (sums.length) fields.push(`sum: ${r}_sum_fields`, `avg: ${r}_avg_fields`);
  if (extremes.length) fields.push(`max: ${r}_max_fields`, `min: ${r}_min_fields`);
  out.push(`type ${r}_aggregate_fields { ${list(fields)} }`);
  if (sums.length) for (const kind of ['sum', 'avg']) out.push(`type ${r}_${kind}_fields { ${list(sums.map((c) => `${c.field}: Float`))} }`);
  if (extremes.length) for (const kind of ['max', 'min']) out.push(`type ${r}_${kind}_fields { ${list(extremes.map((c) => `${c.field}: ${c.type}`))} }`);
  return out;
}

function rootFields(t: HasuraTableModel): string[] {
  const r = t.root, args = `(where: ${r}_bool_exp, order_by: [${r}_order_by!], limit: Int, offset: Int)`;
  return [
    `  ${r}${args}: [${r}!]!`,
    `  ${r}_by_pk(_id: ID!): ${r}`,
    ...(t.aggregations ? [`  ${r}_aggregate${args}: ${r}_aggregate!`] : []),
  ];
}

/** The SDL for these tables (at least one), as the role sees them. */
export function hasuraSdl(tables: readonly HasuraTableModel[]): string {
  if (!tables.length) throw new Error('dataset_not_found');
  return [...PRELUDE, ...tables.flatMap(tableTypes), `type Query {\n${tables.flatMap(rootFields).join('\n')}\n}`, ''].join('\n');
}

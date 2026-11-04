/**
 * THE GENERATED SCHEMA (Hasura v2 subset) for one caller's role. The model holds only what the role may
 * select: a hidden column is in no type (row, bool_exp, order_by, select_column, aggregate fields), so it
 * cannot be read, filtered, sorted, aggregated or introspected. `<root>_aggregate` exists only when the select
 * rule has `allow_aggregations`. Shared input types come once from the prelude.
 *
 * The mutation root is generated from the role's insert, update and delete rules (`write`): a root exists only
 * for a rule the role has, and the insert and `_set` inputs name only the rule's columns less its presets
 * (`_inc` its numeric ones), which may include columns the role cannot select. `returning`, `insert_<root>_one`
 * and the `_by_pk` roots need the select rule, as in Hasura; `where` names `_id` and the selectable columns only.
 * A role that writes but selects nothing gets Hasura's `no_queries_available` query root.
 */
import { DATASET_COLUMN_OPERATORS, DATASET_ID_OPERATORS, type DatasetColumnOperator, type DatasetTableName } from '@artifactbin/contracts';

export type HasuraScalar = 'String' | 'Float' | 'Boolean';
export interface HasuraColumn {
  /** The GraphQL field name (lib/dataset-graphql/hasura-names). */
  field: string;
  /** The stored source column it reads. */
  source: string;
  type: HasuraScalar;
  /** A text column the policy names in `collaborative_columns`: its object field says so in the SDL. */
  collaborative?: boolean;
}
/** The description a collaborative column's field carries (pages bind it with `@afbin/collab`). */
const COLLABORATIVE_DESCRIPTION = 'Collaborative: typed live together with @afbin/collab (collaborative_columns).';
export interface HasuraTableModel {
  root: string;
  /** The engine table the reads compile against. */
  table: DatasetTableName;
  /** The columns the role may select, in declared order. */
  columns: readonly HasuraColumn[];
  aggregations: boolean;
  /** The select rule's row limit, when it has one. */
  limit?: number;
  /** May the role select this table (default true)? Without it `columns` is empty and only `write` applies. */
  select?: boolean;
  write?: HasuraWriteModel;
}
/** The columns each of the role's write rules lets it name; an absent key is a rule the role does not have. */
export interface HasuraWriteModel {
  /** Columns an insert may name: the rule's columns less its presets. */
  insert?: readonly HasuraColumn[];
  /** Columns `_set` may name (`_inc`: the numeric ones): the rule's columns less its presets. */
  update?: readonly HasuraColumn[];
  delete?: boolean;
}
const selects = (t: HasuraTableModel) => t.select !== false;
/** The write rules this model generates roots for (a rule with nothing left to name generates none). */
function writes(t: HasuraTableModel) {
  const insert = t.write?.insert?.length ? t.write.insert : null;
  const set = t.write?.update?.length ? t.write.update : null;
  const inc = set?.filter(summable).length ? set.filter(summable) : null;
  return { insert, set, inc, delete: !!t.write?.delete };
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

const list = (items: string[]) => items.join(' ');
const fieldsOf = (columns: readonly HasuraColumn[]) => list(columns.map((c) => `${c.field}: ${c.type}`));

function tableTypes(t: HasuraTableModel): string[] {
  const r = t.root, w = writes(t);
  const out: string[] = [];
  if (selects(t)) out.push(`type ${r} { ${list(['_id: ID!', ...t.columns.map((c) => `${c.collaborative ? `${JSON.stringify(COLLABORATIVE_DESCRIPTION)} ` : ''}${c.field}: ${c.type}`)])} }`);
  if (selects(t) || w.set || w.delete) out.push(`input ${r}_bool_exp { ${list([`_and: [${r}_bool_exp!]`, `_or: [${r}_bool_exp!]`, `_not: ${r}_bool_exp`, '_id: ID_comparison_exp', ...t.columns.map((c) => `${c.field}: ${c.type}_comparison_exp`)])} }`);
  if (selects(t)) out.push(`input ${r}_order_by { ${list(['_id: order_by', ...t.columns.map((c) => `${c.field}: order_by`)])} }`);
  out.push(...writeTypes(t));
  if (!selects(t) || !t.aggregations) return out;
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

function writeTypes(t: HasuraTableModel): string[] {
  const r = t.root, w = writes(t);
  if (!w.insert && !w.set && !w.delete) return [];
  return [
    ...(w.insert ? [`input ${r}_insert_input { ${fieldsOf(w.insert)} }`] : []),
    ...(w.set ? [`input ${r}_set_input { ${fieldsOf(w.set)} }`] : []),
    ...(w.inc ? [`input ${r}_inc_input { ${fieldsOf(w.inc)} }`] : []),
    ...(w.set && selects(t) ? [`input ${r}_pk_columns_input { _id: ID! }`] : []),
    `type ${r}_mutation_response { affected_rows: Int!${selects(t) ? ` returning: [${r}!]!` : ''} }`,
  ];
}

function mutationFields(t: HasuraTableModel): string[] {
  const r = t.root, w = writes(t), one = selects(t);
  const changes = [...(w.set ? [`_set: ${r}_set_input`] : []), ...(w.inc ? [`_inc: ${r}_inc_input`] : [])].join(', ');
  return [
    ...(w.insert ? [`  insert_${r}(objects: [${r}_insert_input!]!): ${r}_mutation_response`, ...(one ? [`  insert_${r}_one(object: ${r}_insert_input!): ${r}`] : [])] : []),
    ...(w.set ? [`  update_${r}(where: ${r}_bool_exp!, ${changes}): ${r}_mutation_response`, ...(one ? [`  update_${r}_by_pk(pk_columns: ${r}_pk_columns_input!, ${changes}): ${r}`] : [])] : []),
    ...(w.delete ? [`  delete_${r}(where: ${r}_bool_exp!): ${r}_mutation_response`, ...(one ? [`  delete_${r}_by_pk(_id: ID!): ${r}`] : [])] : []),
  ];
}

function rootFields(t: HasuraTableModel): string[] {
  if (!selects(t)) return [];
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
  const queries = tables.flatMap(rootFields), mutations = tables.flatMap(mutationFields);
  return [
    ...PRELUDE,
    ...tables.flatMap(tableTypes),
    `type Query {\n${(queries.length ? queries : ['  no_queries_available: String!']).join('\n')}\n}`,
    ...(mutations.length ? [`type Mutation {\n${mutations.join('\n')}\n}`] : []),
    '',
  ].join('\n');
}

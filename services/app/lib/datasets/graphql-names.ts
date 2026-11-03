/**
 * GENERATED GRAPHQL NAMES for a dataset's tables (roots) and columns (fields), role-independent: they are
 * computed over every declared table and column, so a role that sees less never sees other names.
 *
 * A name that is already a valid GraphQL name (`^[A-Za-z][A-Za-z0-9_]*$`) and not reserved is kept. Anything
 * else is normalized: lower-cased, non-alphanumeric runs to `_`, trimmed, `c_` before a leading digit. A
 * collision takes `_2`, `_3`. Names stored in the table's `configuration` (`custom_name`,
 * `custom_column_names`) always win and are never recomputed, and a stored name is never handed to another
 * column, even after its own column is gone.
 *
 * Valid names are placed before normalized ones, so a valid name never depends on column order; only two
 * normalized names colliding with each other are settled by declared order. Persisting the assignment
 * when a column first appears (the policy's `configuration`, server-owned) arrives with the stored v3
 * policies; until then a stored v3 configuration is honoured and everything else is derived here.
 */
import { DATASET_GRAPHQL_RESERVED_FIELDS, type DatasetTableConfiguration, type DatasetTableName } from '@artifactbin/contracts';

const VALID = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED_FIELDS: ReadonlySet<string> = new Set(DATASET_GRAPHQL_RESERVED_FIELDS);
const reservedField = (name: string) => RESERVED_FIELDS.has(name) || name.startsWith('__');
const usable = (name: string) => VALID.test(name) && !reservedField(name);

/** Lower-case, non-alphanumeric runs to `_`, trimmed, `c_` before a leading digit; `fallback` when nothing is left. */
function normalizeGraphqlName(source: string, fallback: string): string {
  const name = source.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  if (!name) return fallback;
  return /^[0-9]/.test(name) ? `c_${name}` : name;
}

/** `base`, else `base_2`, `base_3`… the first one `free` accepts. */
function suffixed(base: string, free: (name: string) => boolean): string {
  if (free(base)) return base;
  for (let i = 2; ; i++) if (free(`${base}_${i}`)) return `${base}_${i}`;
}

/** Source column name → GraphQL field name, for every column. `prior` is the stored `custom_column_names`. */
export function hasuraColumnNames(columns: readonly string[], prior: Readonly<Record<string, string>> = {}): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  // Stored names first; every stored name stays taken, its column present or not.
  for (const [source, name] of Object.entries(prior)) {
    if (typeof name !== 'string' || !usable(name) || used.has(name)) continue;
    used.add(name);
    if (columns.includes(source)) out[source] = name;
  }
  const rest = columns.filter((source) => !Object.hasOwn(out, source));
  for (const source of rest) if (usable(source) && !used.has(source)) { out[source] = source; used.add(source); }
  for (const source of rest) {
    if (Object.hasOwn(out, source)) continue;
    const name = suffixed(normalizeGraphqlName(source, 'column'), (n) => !used.has(n) && !reservedField(n));
    out[source] = name;
    used.add(name);
  }
  return out;
}

/** Shared prelude types (and the GraphQL root and scalar types) no root may shadow. */
const SHARED_TYPES = ['Query', 'Mutation', 'Subscription', 'String', 'Float', 'Int', 'Boolean', 'ID', 'order_by', 'String_comparison_exp', 'Float_comparison_exp', 'Boolean_comparison_exp', 'ID_comparison_exp', 'dataset_meta', 'dataset_person'];

/** Every field and type name a root generates, today's reads and the planned mutations and extensions. */
export function hasuraGeneratedNames(root: string): string[] {
  const types = ['bool_exp', 'order_by', 'select_column', 'aggregate', 'aggregate_fields', 'sum_fields', 'avg_fields', 'min_fields', 'max_fields', 'insert_input', 'set_input', 'inc_input', 'pk_columns_input', 'mutation_response', 'groups', 'group_keys', 'meta', 'people', 'by_pk'];
  return [root, ...types.map((t) => `${root}_${t}`), ...['insert', 'update', 'delete'].map((verb) => `${verb}_${root}`), `insert_${root}_one`, `update_${root}_by_pk`, `delete_${root}_by_pk`];
}

/** The longest root name a dataset may be given at creation. */
const DATASET_GRAPHQL_NAME_MAX = 64;

/**
 * Why `name` cannot be a dataset's GraphQL root, or null when it can: a valid GraphQL name of at most 64
 * characters, not reserved (`__*`, `_id`, `_and`, `_or`, `_not`, the literals) and generating no field or type a
 * shared type already names (`dataset` would generate `dataset_meta`). Checked once, at creation: the name is stored
 * and never recomputed, so a name that would be suffixed later is refused now.
 */
export function graphqlRootNameProblem(name: unknown): string | null {
  if (typeof name !== 'string' || !VALID.test(name) || name.length > DATASET_GRAPHQL_NAME_MAX)
    return `name must match ^[A-Za-z][A-Za-z0-9_]*$ and be at most ${DATASET_GRAPHQL_NAME_MAX} characters`;
  if (reservedField(name)) return `${name} is reserved in GraphQL`;
  const shadowed = hasuraGeneratedNames(name).find((generated) => SHARED_TYPES.includes(generated));
  return shadowed ? `${name} would generate ${shadowed}, a shared GraphQL type` : null;
}

export interface HasuraRootOptions {
  /** The dataset's title: a flat dataset's root without a stored `custom_name`. */
  title?: string | null;
  /** The stored table configuration (v3 policy), if any. */
  configuration?: (table: DatasetTableName) => DatasetTableConfiguration | undefined;
}

/**
 * One root per table, in order. A single-table dataset is named by its `custom_name`, else its title, else
 * `data`; a multi-table dataset by each table's `custom_name`, else the table's name. No root's generated
 * names meet another root's, or a shared type.
 */
export function hasuraRootNames(tables: readonly DatasetTableName[], options: HasuraRootOptions = {}): string[] {
  const used = new Set<string>(SHARED_TYPES);
  return tables.map((table) => {
    const stored = options.configuration?.(table)?.custom_name;
    const base = typeof stored === 'string' && VALID.test(stored) && !stored.startsWith('__') ? stored
      : tables.length === 1 ? normalizeGraphqlName(options.title?.trim() ?? '', 'data')
      : VALID.test(table.name) && !table.name.startsWith('__') ? table.name : normalizeGraphqlName(table.name, 'table');
    const root = suffixed(base, (name) => hasuraGeneratedNames(name).every((n) => !used.has(n)));
    for (const name of hasuraGeneratedNames(root)) used.add(name);
    return root;
  });
}

/** The configuration a stored v3 policy carries per table; nothing for v1/v2/no policy (until the stored rewrite). */
export function storedConfiguration(policy: unknown): (table: DatasetTableName) => DatasetTableConfiguration | undefined {
  const tables = policy && typeof policy === 'object' && (policy as { version?: unknown }).version === 3 ? (policy as { tables?: unknown }).tables : undefined;
  const list = Array.isArray(tables) ? tables as Array<{ table?: Partial<DatasetTableName>; configuration?: unknown }> : [];
  return (table) => {
    const found = list.find((t) => t?.table?.schema === table.schema && t.table.name === table.name)?.configuration;
    return found && typeof found === 'object' && !Array.isArray(found) ? found as DatasetTableConfiguration : undefined;
  };
}

/** A table's generated root and its columns' field names (source → field). */
export interface HasuraTableNames { root: string; columns: Readonly<Record<string, string>> }

/** Roots and column names for every declared table, in order (role-independent). */
export function hasuraNames(tables: ReadonlyArray<DatasetTableName & { columns: ReadonlyArray<{ name: string }> }>, options: HasuraRootOptions = {}): HasuraTableNames[] {
  const roots = hasuraRootNames(tables, options);
  return tables.map((table, i) => {
    const prior = options.configuration?.(table)?.custom_column_names;
    return { root: roots[i]!, columns: hasuraColumnNames(table.columns.map((c) => c.name), prior && typeof prior === 'object' ? prior : {}) };
  });
}

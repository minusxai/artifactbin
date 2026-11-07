import {
  DATASET_ADMIN_ROLES,
  DATASET_COLUMN_OPERATORS,
  DATASET_ID_OPERATORS,
  DATASET_PERMISSION_LIMITS,
  DATASET_PERMISSION_TEMPLATES,
  DATASET_ROW_ID,
  DATASET_RULE_ROLES,
  DATASET_SESSION_VARIABLES,
  type DatasetBoolExp,
  type DatasetPermissionEntry,
  type DatasetPermissions,
  type DatasetPermissionsIssue,
  type DatasetPermissionsReadBack,
  type DatasetPermissionsResult,
  type DatasetPermissionsShape,
  type DatasetPermissionWarning,
  type DatasetPermissionWarningCode,
  type DatasetRuleRole,
  type DatasetTableName,
  type DatasetTablePermissions,
  type Scalar,
  type Visibility,
} from '@artifactbin/contracts';

/*
 * Version 3 dataset permissions (Hasura metadata shape): a strict validator that reports every
 * problem by JSON path, the plain-language read-back every surface shows, and the three templates.
 * Pure: no I/O, no clock, deterministic output order.
 */

type Obj = Record<string, unknown>;
const OPERATIONS = ['select', 'insert', 'update', 'delete'] as const;
type Operation = (typeof OPERATIONS)[number];
const FIELDS: Record<Operation, string[]> = {
  select: ['columns', 'filter', 'limit', 'allow_aggregations'],
  insert: ['columns', 'check', 'set', 'backend_only'],
  update: ['columns', 'filter', 'check', 'set', 'backend_only'],
  delete: ['filter', 'backend_only'],
};
const list = (items: readonly string[]) => items.join(', ');
const ROLES_HINT = `roles are ${list(DATASET_RULE_ROLES)}`;
const OPERATORS_HINT = `operators are ${list(DATASET_COLUMN_OPERATORS)}`;
const SESSION_HINT = `session variables are ${list(DATASET_SESSION_VARIABLES)}`;
const PATTERN_OPERATORS = new Set(['_like', '_nlike', '_ilike', '_nilike']);
const isObject = (v: unknown): v is Obj =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const tableKey = (t: DatasetTableName) => `${t.schema}.${t.name}`;
const isSessionName = (v: unknown): v is string =>
  typeof v === 'string' && /^x-hasura-/i.test(v);
const sessionVariable = (v: string) =>
  DATASET_SESSION_VARIABLES.find((s) => s.toLowerCase() === v.toLowerCase());

class Collector {
  readonly errors: DatasetPermissionsIssue[] = [];
  add(path: string, message: string) {
    this.errors.push({ path, message });
  }
  /** Unknown keys first, in input order, so the rest of the object is still checked. */
  keys(value: Obj, allowed: readonly string[], path: string) {
    for (const key of Object.keys(value))
      if (!allowed.includes(key))
        this.add(`${path}.${key}`, `unsupported field "${key}"`);
  }
  object(value: unknown, path: string): Obj | undefined {
    if (isObject(value)) return value;
    this.add(path, 'expected an object');
    return undefined;
  }
  boolean(value: unknown, path: string) {
    if (value !== undefined && typeof value !== 'boolean')
      this.add(path, 'expected true or false');
  }
  string(value: unknown, path: string, nullable = false) {
    if (value === undefined || (nullable && value === null)) return;
    if (typeof value !== 'string') this.add(path, 'expected a string');
  }
}

/** A column name the role may list or preset: a known source column, never the row ID. */
function columnName(
  c: Collector,
  name: string,
  path: string,
  columns: readonly string[] | undefined,
) {
  if (name === DATASET_ROW_ID)
    c.add(path, `"${DATASET_ROW_ID}" is the row ID; it cannot be listed or set`);
  else if (columns && !columns.includes(name))
    c.add(path, `unknown column "${name}"; columns are ${list(columns)}`);
}

function columnList(
  c: Collector,
  value: unknown,
  path: string,
  columns: readonly string[] | undefined,
) {
  if (value === '*') return;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !v)) {
    c.add(path, 'expected "*" or a list of column names');
    return;
  }
  const seen = new Set<string>();
  value.forEach((name: string, i) => {
    if (seen.has(name)) c.add(`${path}[${i}]`, `duplicate column "${name}"`);
    else columnName(c, name, `${path}[${i}]`, columns);
    seen.add(name);
  });
}

/** A literal compared or preset: a scalar, and a session reference must be one we set. */
function value(c: Collector, v: unknown, path: string, nullable: boolean) {
  if (v === null) {
    if (!nullable) c.add(path, 'null comparisons use _is_null');
    return;
  }
  if (
    !['string', 'number', 'boolean'].includes(typeof v) ||
    (typeof v === 'number' && !Number.isFinite(v))
  ) {
    c.add(path, 'expected a string, number or boolean');
    return;
  }
  if (isSessionName(v) && !sessionVariable(v))
    c.add(path, `unknown session variable "${v}"; ${SESSION_HINT}`);
}

function comparison(c: Collector, field: string, v: unknown, path: string) {
  if (!isObject(v)) {
    c.add(path, 'expected an operator object such as {"_eq": value}');
    return 0;
  }
  let count = 0;
  const allowed: readonly string[] =
    field === DATASET_ROW_ID ? DATASET_ID_OPERATORS : DATASET_COLUMN_OPERATORS;
  for (const [op, x] of Object.entries(v)) {
    const p = `${path}.${op}`;
    count++;
    if (!allowed.includes(op)) {
      if (op.startsWith('$') && allowed.includes(`_${op.slice(1)}`))
        c.add(p, `unsupported operator "${op}"; use "_${op.slice(1)}"`);
      else if (field === DATASET_ROW_ID)
        c.add(p, `unsupported operator "${op}" for ${DATASET_ROW_ID}; operators are ${list(DATASET_ID_OPERATORS)}`);
      else c.add(p, `unsupported operator "${op}"; ${OPERATORS_HINT}`);
    } else if (op === '_is_null') c.boolean(x, p);
    else if (op === '_in' || op === '_nin') {
      if (isSessionName(x) && !sessionVariable(x)) value(c, x, p, false);
      else if (!Array.isArray(x) || x.length > DATASET_PERMISSION_LIMITS.inValues)
        c.add(p, `expected an array of at most ${DATASET_PERMISSION_LIMITS.inValues} values`);
      else x.forEach((y, i) => value(c, y, `${p}[${i}]`, false));
    } else if (PATTERN_OPERATORS.has(op) && typeof x !== 'string')
      c.add(p, 'expected a text pattern');
    else value(c, x, p, false);
  }
  return count;
}

/** Returns the number of column comparisons, for the per-expression bound. */
function boolExp(
  c: Collector,
  v: unknown,
  path: string,
  columns: readonly string[] | undefined,
  depth = 0,
): number {
  if (depth > DATASET_PERMISSION_LIMITS.depth) {
    c.add(path, `nesting deeper than ${DATASET_PERMISSION_LIMITS.depth}`);
    return 0;
  }
  const o = c.object(v, path);
  if (!o) return 0;
  let count = 0;
  for (const [field, x] of Object.entries(o)) {
    const p = `${path}.${field}`;
    if (field === '_and' || field === '_or') {
      if (!Array.isArray(x)) c.add(p, 'expected an array');
      else
        x.forEach((y, i) => {
          count += boolExp(c, y, `${p}[${i}]`, columns, depth + 1);
        });
    } else if (field === '_not') {
      if (isObject(x)) count += boolExp(c, x, p, columns, depth + 1);
      else c.add(p, 'expected an object');
    } else if (field.startsWith('$') && ['and', 'or', 'not'].includes(field.slice(1)))
      c.add(p, `unsupported expression "${field}"; use "_${field.slice(1)}"`);
    else if ((field.startsWith('_') && field !== DATASET_ROW_ID) || field.startsWith('$'))
      c.add(p, `unsupported expression "${field}"; use _and, _or, _not or a column name`);
    else if (field !== DATASET_ROW_ID && columns && !columns.includes(field))
      c.add(p, `unknown column "${field}"; columns are ${list(columns)}`);
    else count += comparison(c, field, x, p);
  }
  return count;
}

function predicate(
  c: Collector,
  v: unknown,
  path: string,
  columns: readonly string[] | undefined,
) {
  if (v === undefined) {
    c.add(path, 'required');
    return;
  }
  if (boolExp(c, v, path, columns) > DATASET_PERMISSION_LIMITS.predicates)
    c.add(path, `more than ${DATASET_PERMISSION_LIMITS.predicates} comparisons`);
}

function permission(
  c: Collector,
  op: Operation,
  perm: Obj,
  path: string,
  columns: readonly string[] | undefined,
) {
  c.keys(perm, FIELDS[op], path);
  if (op !== 'delete') {
    if (perm.columns === undefined) {
      if (op !== 'insert') c.add(`${path}.columns`, 'required');
    } else columnList(c, perm.columns, `${path}.columns`, columns);
  }
  if (op !== 'insert') predicate(c, perm.filter, `${path}.filter`, columns);
  if (op === 'insert') predicate(c, perm.check, `${path}.check`, columns);
  if (op === 'update' && perm.check !== undefined && perm.check !== null)
    predicate(c, perm.check, `${path}.check`, columns);
  if (op === 'select') {
    const limit = perm.limit;
    if (
      limit !== undefined &&
      (!Number.isInteger(limit) ||
        (limit as number) < 0 ||
        (limit as number) > DATASET_PERMISSION_LIMITS.selectLimit)
    )
      c.add(`${path}.limit`, `expected a whole number from 0 to ${DATASET_PERMISSION_LIMITS.selectLimit}`);
    c.boolean(perm.allow_aggregations, `${path}.allow_aggregations`);
  }
  if ((op === 'insert' || op === 'update') && perm.set !== undefined) {
    const set = c.object(perm.set, `${path}.set`);
    if (set)
      for (const [col, v] of Object.entries(set)) {
        const p = `${path}.set.${col}`;
        columnName(c, col, p, columns);
        value(c, v, p, true);
      }
  }
  if (op !== 'select') c.boolean(perm.backend_only, `${path}.backend_only`);
}

function entries(
  c: Collector,
  op: Operation,
  value: unknown,
  path: string,
  columns: readonly string[] | undefined,
) {
  if (!Array.isArray(value)) {
    c.add(path, 'expected an array');
    return;
  }
  const roles = new Set<string>();
  value.forEach((entry, i) => {
    const ep = `${path}[${i}]`;
    const e = c.object(entry, ep);
    if (!e) return;
    c.keys(e, ['role', 'permission', 'comment'], ep);
    const role = e.role;
    if (typeof role !== 'string') c.add(`${ep}.role`, `expected a role; ${ROLES_HINT}`);
    else if ((DATASET_ADMIN_ROLES as readonly string[]).includes(role))
      c.add(`${ep}.role`, `${role} always has full access, so rules cannot name it; ${ROLES_HINT}`);
    else if (!(DATASET_RULE_ROLES as readonly string[]).includes(role))
      c.add(`${ep}.role`, `unknown role "${role}"; ${ROLES_HINT}`);
    else if (roles.has(role))
      c.add(`${ep}.role`, `duplicate role "${role}"; one entry per role per operation`);
    if (typeof role === 'string') roles.add(role);
    c.string(e.comment, `${ep}.comment`, true);
    const perm = c.object(e.permission, `${ep}.permission`);
    if (perm) permission(c, op, perm, `${ep}.permission`, columns);
  });
}

function configuration(c: Collector, value: unknown, path: string) {
  const o = c.object(value, path);
  if (!o) return;
  c.keys(o, ['custom_name', 'custom_column_names'], path);
  c.string(o.custom_name, `${path}.custom_name`);
  if (o.custom_column_names === undefined) return;
  const names = c.object(o.custom_column_names, `${path}.custom_column_names`);
  if (names)
    for (const [k, v] of Object.entries(names))
      c.string(v, `${path}.custom_column_names.${k}`);
}

/**
 * Checks a v3 document and returns every problem, or an independent copy of the input. Without
 * `shape`, only structure is checked; with it, unknown tables and columns are errors too.
 */
export function validateDatasetPermissions(
  input: unknown,
  shape?: DatasetPermissionsShape,
): DatasetPermissionsResult {
  const c = new Collector();
  const json = isObject(input) ? JSON.stringify(input) : undefined;
  if (json === undefined) c.add('policy', 'expected an object');
  else if (json.length > DATASET_PERMISSION_LIMITS.bytes) c.add('policy', 'larger than 64 KB');
  if (c.errors.length) return { ok: false, errors: c.errors };
  const p = input as Obj;
  c.keys(p, ['version', 'tables'], 'policy');
  // Top-level paths read better without the `policy.` prefix.
  for (const e of c.errors) e.path = e.path.replace(/^policy\./, '');
  if (p.version !== 3) c.add('version', 'expected 3');
  if (!Array.isArray(p.tables) || p.tables.length > DATASET_PERMISSION_LIMITS.tables)
    c.add('tables', `expected an array of at most ${DATASET_PERMISSION_LIMITS.tables} tables`);
  else {
    const known = new Map(shape?.tables.map((t) => [tableKey(t.table), t.columns]));
    const seen = new Set<string>();
    p.tables.forEach((value, i) => {
      const path = `tables[${i}]`;
      const t = c.object(value, path);
      if (!t) return;
      c.keys(t, ['table', 'configuration', 'collaborative_columns', ...OPERATIONS.map((op) => `${op}_permissions`)], path);
      let columns: readonly string[] | undefined;
      const name = t.table;
      if (
        !isObject(name) ||
        Object.keys(name).some((k) => k !== 'schema' && k !== 'name') ||
        typeof name.schema !== 'string' ||
        !name.schema ||
        typeof name.name !== 'string' ||
        !name.name
      )
        c.add(`${path}.table`, 'expected {"schema": "…", "name": "…"}');
      else {
        const key = tableKey(name as unknown as DatasetTableName);
        if (seen.has(key)) c.add(`${path}.table`, `duplicate table "${key}"`);
        else if (shape && !known.has(key))
          c.add(`${path}.table`, `unknown table "${key}"; tables are ${list([...known.keys()])}`);
        seen.add(key);
        columns = known.get(key);
      }
      if (t.configuration !== undefined) configuration(c, t.configuration, `${path}.configuration`);
      if (t.collaborative_columns !== undefined) {
        if (t.collaborative_columns === '*') c.add(`${path}.collaborative_columns`, 'expected a list of column names');
        else columnList(c, t.collaborative_columns, `${path}.collaborative_columns`, columns);
      }
      for (const op of OPERATIONS) {
        const key = `${op}_permissions`;
        if (t[key] !== undefined) entries(c, op, t[key], `${path}.${key}`, columns);
      }
    });
  }
  return c.errors.length
    ? { ok: false, errors: c.errors }
    : { ok: true, policy: structuredClone(p) as unknown as DatasetPermissions };
}

// ---- Templates ----

const USER = 'X-Hasura-User-Id';
const READ_ALL = { columns: '*' as const, filter: {}, allow_aggregations: true };

/** One of the three starting policies, built for the dataset's own tables and columns. */
export function datasetPermissionsTemplate(
  template: string,
  shape: DatasetPermissionsShape,
  options: { ownerColumn?: string } = {},
): DatasetPermissionsResult {
  if (!(DATASET_PERMISSION_TEMPLATES as readonly string[]).includes(template))
    return {
      ok: false,
      errors: [{ path: 'template', message: `unknown template "${template}"; templates are ${list(DATASET_PERMISSION_TEMPLATES)}` }],
    };
  const owner = options.ownerColumn;
  if (template === 'own-rows') {
    if (!owner)
      return { ok: false, errors: [{ path: 'ownerColumn', message: 'own-rows needs an owner column' }] };
    const errors = shape.tables
      .filter((t) => !t.columns.includes(owner))
      .map((t) => ({
        path: 'ownerColumn',
        message: `unknown column "${owner}" in ${tableKey(t.table)}; columns are ${list(t.columns)}`,
      }));
    if (errors.length) return { ok: false, errors };
  }
  const tables = shape.tables.map(({ table, columns }): DatasetTablePermissions => {
    if (template === 'editors-only') return { table: { ...table } };
    const select_permissions = DATASET_RULE_ROLES.map((role) => ({ role, permission: { ...READ_ALL } }));
    if (template === 'read-only' || !owner) return { table: { ...table }, select_permissions };
    const writable = columns.filter((col) => col !== owner);
    const mine = () => ({ [owner]: { _eq: USER } });
    const writers: DatasetRuleRole[] = ['viewer', 'signed_in'];
    return {
      table: { ...table },
      select_permissions,
      insert_permissions: writers.map((role) => ({
        role,
        permission: { columns: [...writable], check: {}, set: { [owner]: USER } },
      })),
      update_permissions: writers.map((role) => ({
        role,
        permission: { columns: [...writable], filter: mine(), check: mine() },
      })),
      delete_permissions: writers.map((role) => ({ role, permission: { filter: mine() } })),
    };
  });
  return { ok: true, policy: { version: 3, tables } };
}

// ---- Read-back ----

const ROLE_NAMES: Record<DatasetRuleRole, string> = {
  viewer: 'shared viewers',
  signed_in: 'signed-in link holders',
  anonymous: 'signed-out link holders',
};
const WARNINGS: Record<DatasetPermissionWarningCode, string> = {
  anonymous_write: 'anonymous can write (throttled to 30 per minute)',
  page_id_direct_denied: 'rule uses X-Hasura-Page-Id: direct API calls are denied',
  update_without_check: 'update without check lets rows move out of the filter',
  private_dataset: 'dataset is private: signed_in and anonymous rules never apply',
};
const OPERATOR_WORDS: Record<string, string> = {
  _eq: 'is',
  _neq: 'is not',
  _gt: 'is above',
  _gte: 'is at least',
  _lt: 'is below',
  _lte: 'is at most',
  _in: 'is one of',
  _nin: 'is not one of',
  _like: 'matches',
  _nlike: 'does not match',
  _ilike: 'matches',
  _nilike: 'does not match',
};
const and = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
const or = (items: string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isEmpty = (e: DatasetBoolExp | null | undefined) => !e || Object.keys(e).length === 0;

function literal(v: Scalar): string {
  if (typeof v === 'string') {
    const session = sessionVariable(v);
    if (session === 'X-Hasura-User-Id') return 'them';
    if (session === 'X-Hasura-Page-Id') return 'this page';
    if (session === 'X-Hasura-Role') return 'their role';
  }
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

function describe(e: DatasetBoolExp, nested = false): string {
  const parts: string[] = [];
  for (const [field, x] of Object.entries(e)) {
    if (field === '_and') {
      const items = (x as DatasetBoolExp[]).filter((y) => !isEmpty(y)).map((y) => describe(y, true));
      if (items.length) parts.push(items.join(' and '));
    } else if (field === '_or') {
      const items = (x as DatasetBoolExp[]).map((y) => (isEmpty(y) ? 'always' : describe(y, true)));
      parts.push(items.length > 1 ? `(${items.join(' or ')})` : (items[0] ?? 'never'));
    } else if (field === '_not') parts.push(`not (${describe(x as DatasetBoolExp, true)})`);
    else
      for (const [op, v] of Object.entries(x as Record<string, unknown>)) {
        if (op === '_is_null') parts.push(`${field} is ${v ? '' : 'not '}empty`);
        else if (op === '_in' || op === '_nin')
          parts.push(`${field} ${OPERATOR_WORDS[op]} ${or((v as Scalar[]).map(literal))}`);
        else
          parts.push(
            `${field} ${OPERATOR_WORDS[op]} ${literal(v as Scalar)}${op === '_ilike' || op === '_nilike' ? ' in any case' : ''}`,
          );
      }
  }
  return parts.join(' and ') || (nested ? 'always' : '');
}

/** `{column: {_eq: X-Hasura-User-Id}}`: the column, else undefined. */
function ownerColumnOf(e: DatasetBoolExp | null | undefined): string | undefined {
  const [field, ...rest] = Object.keys(e ?? {});
  if (!field || rest.length || field.startsWith('_')) return undefined;
  const ops = (e as Record<string, Record<string, unknown>>)[field];
  const keys = Object.keys(ops ?? {});
  return keys.length === 1 && keys[0] === '_eq' && typeof ops?._eq === 'string' && sessionVariable(ops._eq) === USER
    ? field
    : undefined;
}

function presets(set: Record<string, Scalar> | undefined): string[] {
  return Object.entries(set ?? {}).map(([col, v]) => `${col} is set to ${literal(v)}`);
}

function entryFor<P>(list: DatasetPermissionEntry<P>[] | undefined, role: DatasetRuleRole) {
  return list?.find((e) => e.role === role)?.permission;
}

function roleSentence(t: DatasetTablePermissions, role: DatasetRuleRole): string {
  const select = entryFor(t.select_permissions, role);
  const insert = entryFor(t.insert_permissions, role);
  const update = entryFor(t.update_permissions, role);
  const del = entryFor(t.delete_permissions, role);
  if (!select && !insert && !update && !del) return 'no access';
  const createdBy = Object.entries(insert?.set ?? {}).find(
    ([, v]) => typeof v === 'string' && sessionVariable(v) === USER,
  )?.[0];
  const rows = (filter: DatasetBoolExp, any: string, only: string) => {
    if (isEmpty(filter)) return any;
    const owner = ownerColumnOf(filter);
    return owner && owner === createdBy ? `${only}rows they created` : `${only}rows where ${describe(filter)}`;
  };
  const apps = (backendOnly: boolean | undefined) => (backendOnly ? ", only through the owner's apps" : '');
  const clauses: string[] = [];
  if (!select) clauses.push('cannot see rows');
  else {
    const all = select.columns === '*';
    const cols = all ? 'all columns' : select.columns.length ? and(select.columns as string[]) : 'only row IDs';
    let text = isEmpty(select.filter)
      ? all
        ? 'see all rows and columns'
        : `see ${cols}`
      : `see ${cols} of rows where ${describe(select.filter)}`;
    if (select.limit !== undefined) text += `, at most ${select.limit} rows`;
    // allow_aggregations (Hasura's name) is the SQL permission: counts, totals, group by and joins are SQL.
    text += select.allow_aggregations ? ', and run SQL over them' : ' (rows only, no SQL)';
    clauses.push(text);
  }
  if (insert) {
    const details = [
      ...(Array.isArray(insert.columns) ? [`filling ${and(insert.columns)}`] : []),
      ...presets(insert.set),
    ];
    let text = details.length ? `add rows (${details.join('; ')})` : 'add rows';
    if (!isEmpty(insert.check)) text += ` only when ${describe(insert.check)}`;
    clauses.push(text + apps(insert.backend_only));
  }
  if (update) {
    const cols = update.columns === '*' ? 'anything' : and(update.columns);
    const set = presets(update.set);
    let text = `change ${cols}${set.length ? ` (${set.join('; ')})` : ''} ${rows(update.filter, 'on any row', 'only on ')}`;
    if (!isEmpty(update.check) && JSON.stringify(update.check) !== JSON.stringify(update.filter))
      text += `, as long as afterwards ${describe(update.check as DatasetBoolExp)}`;
    clauses.push(text + apps(update.backend_only));
  }
  if (del) clauses.push(rows(del.filter, 'delete any row', 'delete ') + apps(del.backend_only));
  if (!insert && !update && !del) clauses.push('cannot change anything');
  return clauses.join('; ');
}

function usesPageId(value: unknown): boolean {
  if (typeof value === 'string') return sessionVariable(value) === 'X-Hasura-Page-Id';
  if (Array.isArray(value)) return value.some(usesPageId);
  return isObject(value) && Object.values(value).some(usesPageId);
}

/**
 * The plain-language description of who can do what, per table, with warnings. Assumes a policy
 * `validateDatasetPermissions` accepted.
 */
export function readBackDatasetPermissions(
  policy: DatasetPermissions,
  options: { visibility?: Visibility } = {},
): DatasetPermissionsReadBack {
  const found = new Set<DatasetPermissionWarningCode>();
  const tables = policy.tables.map((t) => {
    const name = tableKey(t.table);
    const title = t.configuration?.custom_name
      ? `Table ${t.configuration.custom_name} (${name})`
      : `Table ${name}`;
    const groups = new Map<string, DatasetRuleRole[]>();
    for (const role of DATASET_RULE_ROLES) {
      const sentence = roleSentence(t, role);
      groups.set(sentence, [...(groups.get(sentence) ?? []), role]);
    }
    const lines = [
      'Owner, editors: see and change everything.',
      ...[...groups].map(
        ([sentence, roles]) => `${capitalize(roles.map((r) => ROLE_NAMES[r]).join(', '))}: ${sentence}.`,
      ),
      ...(t.collaborative_columns?.length
        ? [`Typed live together (@afbin/collab) by everyone who may change them: ${and(t.collaborative_columns)}.`]
        : []),
    ];
    const writes = [t.insert_permissions, t.update_permissions, t.delete_permissions];
    if (writes.some((l) => l?.some((e) => e.role === 'anonymous'))) found.add('anonymous_write');
    if (usesPageId([t.select_permissions, ...writes])) found.add('page_id_direct_denied');
    if (t.update_permissions?.some((e) => !isEmpty(e.permission.filter) && isEmpty(e.permission.check)))
      found.add('update_without_check');
    if (
      options.visibility === 'private' &&
      [t.select_permissions, ...writes].some((l) => l?.some((e) => e.role !== 'viewer'))
    )
      found.add('private_dataset');
    return { title, lines };
  });
  const warnings: DatasetPermissionWarning[] = (Object.keys(WARNINGS) as DatasetPermissionWarningCode[])
    .filter((code) => found.has(code))
    .map((code) => ({ code, message: WARNINGS[code] }));
  const text = [
    ...tables.map((t) => [t.title, ...t.lines.map((l) => `- ${l}`)].join('\n')),
    warnings.length ? ['Warnings:', ...warnings.map((w) => `- ${w.message}`)].join('\n') : 'Warnings: none.',
  ].join('\n');
  return { tables, warnings, text };
}

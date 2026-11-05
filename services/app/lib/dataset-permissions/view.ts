/**
 * THE ROLE VIEW: one stored table as one caller's select rule lets them see it. Rows the rule's `filter`
 * admits, in stored order, cut to its `limit`, with only its `columns`. Every row-reading door that is
 * not GraphQL reads this view (lib/datasets `executeCatalog` takes it as its required `view`), so SQL
 * queries, aggregates, downloads, page reads and forks see exactly the same rows.
 *
 * The filter is evaluated here, in three-valued logic, and it FAILS CLOSED: a row is visible only when
 * its predicate is TRUE. NULL, a type mismatch, an unknown operator or column and a missing session
 * value all leave the row out; a predicate naming a column the table no longer has, or a session value
 * the request lacks, hides every row. The platform row ID (`_id`) is read from the column a door that
 * serves IDs carries them in (DATASET_ROW_ID_COLUMN: the generated API, a live cell's row); rows of a
 * door without IDs (SQL, downloads) have none, so a rule naming `_id` keeps none of them there.
 *
 * The filter may read columns the rule hides (it runs on the server). A column list shows only the columns it
 * names (and DOOR_COLUMNS): a column the head no longer declares, read from an archived revision, stays hidden. Which rows are kept depends only on
 * the stored object, the rule and the session, so the kept positions are cached by exactly those
 * (content-addressed: a new revision is a new object key, a new rule a new key); a full view
 * (`columns:"*"`, `filter:{}`, no limit) is the rows themselves, with nothing evaluated or copied.
 */
import { DATASET_ROW_ID, DATASET_ROW_ID_COLUMN, type DatasetBoolExp, type DatasetSelectPermission, type Scalar } from '@artifactbin/contracts';
import { datasetPatternMatch } from '@artifactbin/utils/dataset-policy';

type Row = Record<string, unknown>;
type Truth = boolean | null;
export type DatasetSession = Readonly<Record<string, Scalar>>;

/** A select rule that hides nothing: no materialisation, the stored rows as they are. */
export function unrestricted(permission: DatasetSelectPermission): boolean {
  return permission.columns === '*' && !Object.keys(permission.filter ?? {}).length && permission.limit === undefined;
}

class Unavailable extends Error {}

/** A session variable (`X-Hasura-User-Id`, any case) resolves from the server session; anything else is a literal. */
function sessionValue(value: unknown, session: DatasetSession): unknown {
  if (typeof value !== 'string' || !/^x-hasura-/i.test(value)) return value;
  const key = value.toLowerCase();
  if (!Object.hasOwn(session, key) || session[key] === undefined || session[key] === null) throw new Unavailable(key);
  return session[key];
}

/** -1/0/1, or null when SQL would answer unknown (NULL) or the types are not comparable. */
function compare(a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  let x = a, y = b;
  if (typeof x !== typeof y) {
    const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    const nx = num(x), ny = num(y);
    if (nx === null || ny === null || (typeof x !== 'number' && typeof y !== 'number')) return null;
    x = nx; y = ny;
  }
  if (typeof x === 'number' || typeof x === 'string' || typeof x === 'boolean') return x === y ? 0 : (x as number | string) < (y as number | string) ? -1 : 1;
  return null;
}

const not = (t: Truth): Truth => (t === null ? null : !t);
function and(items: Truth[]): Truth { return items.includes(false) ? false : items.includes(null) ? null : true; }
function or(items: Truth[]): Truth { return items.includes(true) ? true : items.includes(null) ? null : false; }

function inList(value: unknown, list: unknown): Truth {
  if (!Array.isArray(list)) return null;
  return or(list.map((item) => { const c = compare(value, item); return c === null ? null : c === 0; }));
}

/** One column comparison: every operator in it must hold (an empty one is TRUE, as in Hasura). */
function comparison(value: unknown, ops: Record<string, unknown>, session: DatasetSession): Truth {
  return and(Object.entries(ops).map(([op, raw]): Truth => {
    const operand = Array.isArray(raw) ? raw.map((v) => sessionValue(v, session)) : sessionValue(raw, session);
    const c = () => compare(value, operand);
    switch (op) {
      case '_eq': { const r = c(); return r === null ? null : r === 0; }
      case '_neq': { const r = c(); return r === null ? null : r !== 0; }
      case '_gt': { const r = c(); return r === null ? null : r > 0; }
      case '_gte': { const r = c(); return r === null ? null : r >= 0; }
      case '_lt': { const r = c(); return r === null ? null : r < 0; }
      case '_lte': { const r = c(); return r === null ? null : r <= 0; }
      case '_in': return Array.isArray(operand) && !operand.length ? false : inList(value, operand);
      case '_nin': return Array.isArray(operand) && !operand.length ? true : not(inList(value, operand));
      case '_is_null': return typeof operand === 'boolean' ? (value === null || value === undefined) === operand : null;
      // The one matcher the write engine also judges a filter and a check with (utils dataset-policy).
      case '_like': return datasetPatternMatch(value, operand, false);
      case '_nlike': return not(datasetPatternMatch(value, operand, false));
      case '_ilike': return datasetPatternMatch(value, operand, true);
      case '_nilike': return not(datasetPatternMatch(value, operand, true));
      default: return null;
    }
  }));
}

/** The columns a predicate names (outside `_and`/`_or`/`_not`). */
function namedColumns(exp: DatasetBoolExp, into = new Set<string>()): Set<string> {
  for (const [key, value] of Object.entries(exp)) {
    if (key === '_and' || key === '_or') for (const item of (value as DatasetBoolExp[]) ?? []) namedColumns(item, into);
    else if (key === '_not') namedColumns(value as DatasetBoolExp, into);
    else into.add(key);
  }
  return into;
}

function evaluate(exp: DatasetBoolExp, row: Row, session: DatasetSession): Truth {
  return and(Object.entries(exp).map(([key, value]): Truth => {
    if (key === '_and') return Array.isArray(value) ? and(value.map((e) => evaluate(e, row, session))) : null;
    if (key === '_or') return Array.isArray(value) ? or(value.map((e) => evaluate(e, row, session))) : null;
    if (key === '_not') return value && typeof value === 'object' ? not(evaluate(value as DatasetBoolExp, row, session)) : null;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return comparison(row[key === DATASET_ROW_ID ? DATASET_ROW_ID_COLUMN : key], value as Record<string, unknown>, session);
  }));
}

/**
 * The stored positions a rule keeps, in stored order. `columns` are the table's declared source columns:
 * a predicate naming anything else (a dropped column) keeps none; `_id` reads each row's carried ID.
 */
export function keptRows(rows: readonly Row[], columns: readonly string[], permission: DatasetSelectPermission, session: DatasetSession): number[] {
  const filter = permission.filter ?? {};
  const cap = permission.limit ?? Number.POSITIVE_INFINITY;
  const known = new Set(columns);
  for (const name of namedColumns(filter)) if (name !== DATASET_ROW_ID && !known.has(name)) return [];
  const kept: number[] = [];
  try {
    for (let i = 0; i < rows.length && kept.length < cap; i++) if (evaluate(filter, rows[i]!, session) === true) kept.push(i);
  } catch (error) {
    if (error instanceof Unavailable) return [];
    throw error;
  }
  return kept;
}

/** Does a rule's filter admit this one row, as the role view reads a filter (TRUE only, fail closed)? */
export function filterAdmits(filter: DatasetBoolExp, columns: readonly string[], row: Row, session: DatasetSession): boolean {
  return keptRows([row], columns, { columns: '*', filter }, session).length === 1;
}

/**
 * The columns a door adds to stored rows, never stored or declared (the page GraphQL row ID): a column list
 * keeps them. Everything else a list does not name is hidden, declared or not (an archived revision's column).
 */
const DOOR_COLUMNS: ReadonlySet<string> = new Set([DATASET_ROW_ID_COLUMN]);

/** Does this rule show the column? */
export function shows(permission: DatasetSelectPermission, name: string): boolean {
  return permission.columns === '*' || DOOR_COLUMNS.has(name) || permission.columns.includes(name);
}

/** Kept positions by (object, rule, session): content-addressed, bounded, least recently used out first. */
const KEPT_ENTRIES = 256;
const keptCache = new Map<string, number[]>();

/**
 * One stored table's rows through one rule. `objectKey` names the immutable stored object the rows came
 * from (the cache key); without one nothing is cached.
 */
export function viewRows(rows: readonly Row[], columns: readonly string[], permission: DatasetSelectPermission, session: DatasetSession, objectKey?: string): Row[] {
  if (unrestricted(permission)) return rows as Row[];
  // Kept positions depend only on the object, rule and session, except when the rule reads the row IDs a door carries.
  const key = objectKey && !namedColumns(permission.filter ?? {}).has(DATASET_ROW_ID) ? JSON.stringify([objectKey, rows.length, columns, permission.filter ?? {}, permission.limit ?? null, session]) : null;
  let kept = key ? keptCache.get(key) : undefined;
  if (kept) { keptCache.delete(key!); keptCache.set(key!, kept); }
  else {
    kept = keptRows(rows, columns, permission, session);
    if (key) {
      keptCache.set(key, kept);
      if (keptCache.size > KEPT_ENTRIES) keptCache.delete(keptCache.keys().next().value!);
    }
  }
  if (permission.columns === '*') return kept.map((i) => rows[i]!);
  return kept.map((i) => {
    const out: Row = {};
    for (const [name, value] of Object.entries(rows[i]!)) if (shows(permission, name)) out[name] = value;
    return out;
  });
}

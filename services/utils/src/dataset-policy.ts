import type {
  DatasetPolicy,
  PolicyPredicate,
  Scalar,
} from '@artifactbin/contracts';

const comparisons: Record<string, string> = {
  _eq: '=',
  _neq: '<>',
  _gt: '>',
  _gte: '>=',
  _lt: '<',
  _lte: '<=',
};
function bad(path: string, reason: string): never {
  throw new Error(`${path}: ${reason}`);
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    bad(path, 'expected an object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string) {
  for (const key of Object.keys(value))
    if (!allowed.includes(key)) bad(`${path}.${key}`, 'unsupported field');
}
function scalar(value: unknown, path: string): asserts value is Scalar {
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value))
    bad(path, 'expected a scalar');
  if (typeof value === 'number' && !Number.isFinite(value))
    bad(path, 'expected a finite number');
}
function strings(value: unknown, path: string) {
  if (
    !Array.isArray(value) ||
    value.some((v) => typeof v !== 'string' || !v || v.includes('\0')) ||
    new Set(value).size !== value.length
  )
    bad(path, 'expected unique nonempty strings');
}
function predicate(value: unknown, path: string, depth = 0) {
  if (depth > 12) bad(path, 'predicate nesting exceeds 12');
  const o = object(value, path);
  for (const [field, v] of Object.entries(o)) {
    const p = `${path}.${field}`;
    if (field === '_and' || field === '_or') {
      if (!Array.isArray(v)) bad(p, 'expected an array');
      v.forEach((x, i) => predicate(x, `${p}[${i}]`, depth + 1));
    } else if (field === '_not') predicate(v, p, depth + 1);
    else {
      if (field.startsWith('_') || !field || field.includes('\0'))
        bad(p, 'unsupported predicate');
      const ops = object(v, p);
      for (const [op, x] of Object.entries(ops)) {
        if (op === '_is_null') {
          if (typeof x !== 'boolean') bad(p, '_is_null requires a boolean');
        } else if (op === '_in' || op === '_nin') {
          if (!Array.isArray(x)) bad(p, 'expected an array');
          x.forEach((y) => {
            scalar(y, p);
            if (y === null) bad(p, 'null comparisons require _is_null');
          });
        } else if (Object.hasOwn(comparisons, op)) {
          scalar(x, p);
          if (x === null) bad(p, 'null comparisons require _is_null');
        } else bad(`${p}.${op}`, 'unsupported operator');
      }
    }
  }
}
/** Exact supported Hasura fields; unknown extensions never silently disappear. */
export function parseDatasetPolicy(value: unknown): DatasetPolicy {
  if (JSON.stringify(value)?.length > 64_000)
    bad('policy', 'maximum size is 64 KB');
  const p = object(value, 'policy');
  keys(p, ['version', 'enforcement', 'tables', 'execution'], 'policy');
  if (p.version !== 1 || p.enforcement !== 'enabled')
    bad('policy', 'expected version 1 and enabled enforcement');
  if (!Array.isArray(p.tables) || p.tables.length > 64)
    bad('tables', 'expected at most 64 tables');
  const names = new Set<string>();
  p.tables.forEach((value, i) => {
    const path = `tables[${i}]`,
      t = object(value, path);
    keys(
      t,
      [
        'table',
        'insert_permissions',
        'update_permissions',
        'delete_permissions',
      ],
      path,
    );
    const table = object(t.table, `${path}.table`);
    keys(table, ['schema', 'name'], `${path}.table`);
    for (const field of ['schema', 'name'])
      if (
        typeof table[field] !== 'string' ||
        !table[field] ||
        String(table[field]).includes('\0')
      )
        bad(path, 'invalid table identity');
    const name = JSON.stringify([table.schema, table.name]);
    if (names.has(name)) bad(path, 'duplicate table');
    names.add(name);
    for (const op of ['insert', 'update', 'delete']) {
      const entries = t[`${op}_permissions`];
      if (entries === undefined) continue;
      if (!Array.isArray(entries) || entries.length > 32)
        bad(path, 'expected permission entries');
      const roles = new Set<string>();
      entries.forEach((entry, j) => {
        const ep = `${path}.${op}_permissions[${j}]`,
          e = object(entry, ep);
        keys(e, ['role', 'permission', 'comment'], ep);
        if (typeof e.role !== 'string' || !e.role || roles.has(e.role))
          bad(ep, 'invalid or duplicate role');
        roles.add(e.role);
        if (
          e.comment !== undefined &&
          e.comment !== null &&
          typeof e.comment !== 'string'
        )
          bad(ep, 'comment must be a string');
        const perm = object(e.permission, `${ep}.permission`);
        keys(
          perm,
          op === 'delete'
            ? ['filter', 'backend_only']
            : op === 'insert'
              ? ['columns', 'check', 'set', 'backend_only']
              : ['columns', 'filter', 'check', 'set', 'backend_only'],
          ep,
        );
        if (perm.backend_only !== undefined && perm.backend_only !== false)
          bad(ep, 'backend_only true is not supported');
        if (
          (op === 'update' ||
            (op === 'insert' && perm.columns !== undefined)) &&
          perm.columns !== '*'
        )
          strings(perm.columns, `${ep}.columns`);
        if (op !== 'insert') predicate(perm.filter, `${ep}.filter`);
        if (
          op === 'insert' ||
          (op === 'update' && perm.check !== undefined && perm.check !== null)
        )
          predicate(perm.check, `${ep}.check`);
        if (perm.set !== undefined)
          for (const [col, v] of Object.entries(
            object(perm.set, `${ep}.set`),
          )) {
            if (!col || col.includes('\0')) bad(ep, 'invalid preset column');
            scalar(v, `${ep}.set.${col}`);
          }
      });
    }
  });
  if (p.execution !== undefined) {
    const e = object(p.execution, 'execution');
    keys(e, ['functions', 'generation'], 'execution');
    if (e.functions !== undefined) {
      const f = object(e.functions, 'execution.functions');
      keys(f, ['allow', 'deny'], 'execution.functions');
      for (const k of ['allow', 'deny'])
        if (f[k] !== undefined) strings(f[k], `execution.functions.${k}`);
    }
    if (e.generation !== undefined) {
      const g = object(e.generation, 'execution.generation');
      keys(
        g,
        ['models', 'max_calls', 'max_tokens', 'documents'],
        'execution.generation',
      );
      strings(g.models, 'execution.generation.models');
      if (g.documents !== undefined)
        strings(g.documents, 'execution.generation.documents');
      for (const [key, max] of [
        ['max_calls', 10000],
        ['max_tokens', 16384],
      ] as const)
        if (
          !Number.isInteger(g[key]) ||
          Number(g[key]) < 1 ||
          Number(g[key]) > max
        )
          bad(
            `execution.generation.${key}`,
            `expected an integer from 1 to ${max}`,
          );
    }
  }
  return JSON.parse(JSON.stringify(p)) as DatasetPolicy;
}
export function policyValue(
  value: Scalar,
  session: Record<string, Scalar>,
): Scalar {
  if (typeof value === 'string' && /^x-hasura-/i.test(value)) {
    const key = value.toLowerCase();
    if (!Object.hasOwn(session, key))
      bad(key, 'required server session variable is unavailable');
    return session[key];
  }
  return value;
}
/** SQL NULL semantics are delegated to DuckDB, including NOT/AND/OR. */
export function compilePolicyPredicate(
  value: PolicyPredicate,
  columns: string[],
  session: Record<string, Scalar>,
  prefix = 'policy',
): { sql: string; params: Record<string, Scalar> } {
  predicate(value, 'predicate');
  const params: Record<string, Scalar> = {};
  let n = 0;
  const bind = (v: Scalar) => {
    const key = `${prefix}_${n++}`;
    params[key] = policyValue(v, session);
    return `$${key}`;
  };
  const walk = (p: PolicyPredicate): string => {
    const parts = Object.entries(p).map(([field, v]) => {
      if (field === '_and' || field === '_or') {
        const items = (v as PolicyPredicate[]).map(walk);
        return items.length
          ? `(${items.join(field === '_and' ? ' AND ' : ' OR ')})`
          : field === '_and'
            ? 'TRUE'
            : 'FALSE';
      }
      if (field === '_not') return `(NOT ${walk(v as PolicyPredicate)})`;
      if (!columns.includes(field)) bad(field, 'unknown column');
      const col = `"${field.replaceAll('"', '""')}"`;
      const conditions = Object.entries(
        v as Record<string, Scalar | Scalar[]>,
      ).map(([op, x]) => {
        if (op === '_is_null') return `${col} IS ${x ? '' : 'NOT '}NULL`;
        if (op === '_in' || op === '_nin') {
          const list = x as Scalar[];
          return list.length
            ? `${col} ${op === '_nin' ? 'NOT ' : ''}IN (${list.map(bind).join(', ')})`
            : op === '_in'
              ? 'FALSE'
              : 'TRUE';
        }
        return `${col} ${comparisons[op]} ${bind(x as Scalar)}`;
      });
      return conditions.length ? `(${conditions.join(' AND ')})` : 'TRUE';
    });
    return parts.length ? `(${parts.join(' AND ')})` : 'TRUE';
  };
  return { sql: walk(value), params };
}

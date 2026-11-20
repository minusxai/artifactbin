import {isTimestamp} from './timestamp';
export {normalizeDate,isDate,normalizeTimestamp,isTimestamp} from './timestamp';
/** Column inference for rows by value — pure and safe for browser bundles. */
import type { ColumnType, DatasetColumn } from '@artifactbin/contracts/sql';

export type { DatasetColumn } from '@artifactbin/contracts/sql';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date in ISO form: `2025-11-32` matches the pattern but cannot be stored or queried as a date. */
export function isIsoDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

function inferType(v: unknown): ColumnType | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return isIsoDate(v) ? 'date' : /^[0-9]{4}-/.test(v) && isTimestamp(v) ? 'timestamp' : 'string';
  return null;
}

export function inferColumns(rows: Array<Record<string, unknown>>): DatasetColumn[] {
  const order: string[] = [];
  const types = new Map<string, ColumnType>();
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      if (!types.has(k) && !order.includes(k)) order.push(k);
      const t = inferType(v);
      if (t === null) continue;
      const prev = types.get(k);
      if (prev === undefined) types.set(k, t);
      else if (prev !== t) types.set(k, 'string');
    }
  }
  return order.map((name) => ({ name, type: types.get(name) ?? 'string' }));
}

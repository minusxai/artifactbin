import {isTimestamp} from './timestamp';
export {normalizeTimestamp,isTimestamp} from './timestamp';
/** Column inference for rows by value — pure and safe for browser bundles. */
import type { ColumnType, DatasetColumn } from '@artifactbin/contracts';

export type { ColumnType, DatasetColumn } from '@artifactbin/contracts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function inferType(v: unknown): ColumnType | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return DATE_RE.test(v) ? 'date' : /^[0-9]{4}-/.test(v) && isTimestamp(v) ? 'timestamp' : 'string';
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

/** One schema parser for imports, catalog definitions and author declarations. */
export function parseDatasetColumn(raw: unknown): DatasetColumn {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Column must be {name, type, constraints?}');
  const c = raw as Record<string, unknown>;
  if (typeof c.name !== 'string' || !c.name || c.name.includes('\0') || !['string','number','boolean','date','timestamp','user'].includes(String(c.type))) throw new Error('Invalid column name or type; use string, number, boolean, date, timestamp or user');
  if (Object.keys(c).some(k => !['name','type','constraints'].includes(k))) throw new Error('Unknown column attribute');
  const column: DatasetColumn = {name:c.name, type:c.type as ColumnType};
  if (c.constraints !== undefined) {
    if (c.type !== 'user' || !c.constraints || typeof c.constraints !== 'object' || Array.isArray(c.constraints)) throw new Error('User constraints must be an object');
    const constraints = c.constraints as Record<string,unknown>;
    if (Object.keys(constraints).some(k => !['memberOf','self'].includes(k))) throw new Error('Unknown user constraint');
    if (constraints.self !== undefined && typeof constraints.self !== 'boolean') throw new Error('self must be boolean');
    const scopes = constraints.memberOf;
    if (scopes !== undefined && (!Array.isArray(scopes) || !scopes.length || scopes.some(s => typeof s !== 'string' || (s !== 'current' && !/^ref:[A-Za-z0-9]{6,12}$/.test(s))) || new Set(scopes).size !== scopes.length)) throw new Error('memberOf must be a nonempty array of unique document references or current');
    column.constraints = {...(scopes !== undefined ? {memberOf:[...(scopes as string[])]} : {}), ...(constraints.self !== undefined ? {self:constraints.self as boolean} : {})};
  }
  return column;
}

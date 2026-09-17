import { scalarMatches, type Dataflow, type Row, type TableResult } from './dataflow';
import type { DatasetColumn } from './dataset-shape';

export class LocalStateInputError extends Error {}

/** Bound the wire representation before schema validation against the document. */
export function parseLocalTables(value: unknown): Record<string, Row[]> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 64
    || new TextEncoder().encode(JSON.stringify(value)).length > 1_048_576) throw new LocalStateInputError('Invalid or oversized local tables');
  for (const rows of Object.values(value)) {
    if (!Array.isArray(rows) || rows.length > 10_000) throw new LocalStateInputError('Local tables must contain arrays of at most 10000 rows');
  }
  return value as Record<string, Row[]>;
}

/** Rows are data, never a source of schema or extra columns. Missing fields are typed NULL. */
export function checkedLocalRows(rows: unknown, columns: DatasetColumn[]): Row[] {
  if (!Array.isArray(rows) || rows.length > 10_000) throw new LocalStateInputError('Local table must contain at most 10000 rows');
  return rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).some(key => !columns.some(c => c.name === key))) throw new LocalStateInputError('Local row has undeclared fields');
    return Object.fromEntries(columns.map(c => {
      const value: unknown = Object.hasOwn(row, c.name) ? row[c.name] : null;
      if (!scalarMatches(value, c.type)) throw new LocalStateInputError(`Local field "${c.name}" has an invalid type`);
      return [c.name, value];
    }));
  });
}

/** Reader overrides may replace only declared inline rows, never schemas or dataset tables. */
export function localTableOverrides(flow: Dataflow, overrides: Record<string, Row[]> = {}): Record<string, TableResult> {
  return Object.fromEntries(Object.entries(overrides).map(([name, rows]) => {
    const declaration = flow.values.find(v => v.kind === 'table' && v.name === name);
    if (!declaration || declaration.kind !== 'table') throw new LocalStateInputError(`"${name}" is not a declared inline table`);
    return [name, {columns: declaration.columns, rows: checkedLocalRows(rows, declaration.columns)}];
  }));
}

/** Column inference for rows by value — pure and safe for browser bundles. */
import type { ColumnType, DatasetColumn } from '@artifactbin/contracts';

export type { ColumnType, DatasetColumn } from '@artifactbin/contracts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

function inferType(v: unknown): ColumnType | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return DATE_RE.test(v) ? 'date' : 'string';
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

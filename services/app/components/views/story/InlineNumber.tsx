'use client';

/**
 * ADAPTED from minusx InlineNumber: a data-driven figure that
 * flows inside a sentence — `data="$name"` names a table declared in the
 * document, `col` picks the column, optional `agg`
 * (sum|avg|min|max|count|first), `prefix`/`suffix`/`format` (d3-format) shape
 * the display. Bound inputs drive it live through the store, because the
 * table it reads is a query result that re-runs. The digits come from the
 * data, never hand-typed. Renders a <span> inheriting the surrounding
 * typography. Chrome is token classes only (EXTRA_CLASS_SOURCES).
 */
import { numberFormatter } from '@/lib/story/number-format';
import { refName, type TableResult } from '@/lib/story/dataflow';

export type NumberAgg = 'sum' | 'avg' | 'min' | 'max' | 'count' | 'first';

export interface InlineNumberProps {
  /** `"$name"` — a table declared in the document. */
  data: unknown;
  col?: string;
  agg?: NumberAgg;
  prefix?: string;
  suffix?: string;
  format?: string;                  // d3-format spec, e.g. ",.1f"
  /** The document's tables by declared name (the store snapshot). */
  tables?: Record<string, TableResult>;
}

export default function InlineNumber({ data, col, agg = 'first', prefix = '', suffix = '', format, tables }: InlineNumberProps) {
  const name = refName(data);
  const rows: Array<Record<string, unknown>> | null = name && tables?.[name] ? tables[name].rows : null;
  if (!rows) return <span aria-label="Number placeholder">—</span>;
  const column = col ?? Object.keys(rows[0] ?? {})[0];
  const nums = rows.map((r) => Number(r[column])).filter((n) => Number.isFinite(n));
  let value: number;
  switch (agg) {
    case 'count': value = rows.length; break;
    case 'sum': value = nums.reduce((a, b) => a + b, 0); break;
    case 'avg': value = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : NaN; break;
    case 'min': value = nums.length ? Math.min(...nums) : NaN; break;
    case 'max': value = nums.length ? Math.max(...nums) : NaN; break;
    case 'first': default: value = nums[0] ?? NaN; break;
  }
  // A spec d3 cannot parse must not throw here: this renders inside SSR, where a throw is a 500 for the whole document.
  const text = Number.isFinite(value) ? numberFormatter(format)(value) : '—';
  return <span aria-label="Live number">{prefix}{text}{suffix}</span>;
}

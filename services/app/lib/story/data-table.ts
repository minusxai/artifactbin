/**
 * `<DataTable>` — the pure half: what an author may declare per column, how
 * rows sort, how cells format and how conditional formatting maps a value to
 * a width or a color. No React, no DOM: the kit component renders what this
 * computes, and a node test can pin every rule.
 *
 * Authored surface (all JSON, so the markup stays data):
 *   <DataTable data="$sales" height="420px" sort={{"col":"revenue","dir":"desc"}}
 *     columns={[
 *       {"col":"region","title":"Region"},
 *       {"col":"revenue","title":"Revenue","fmt":"$,.0f","align":"right","bar":true},
 *       {"col":"growth","fmt":".1%","colorScale":"diverging"}
 *     ]} />
 * `columns` picks and orders the columns shown (absent = every column of the
 * table, inferred titles); `fmt` is a d3-format string; `bar` draws a
 * proportional bar behind a numeric cell; `colorScale` tints it (`sequential`
 * from the theme's chart color, `diverging` red↔green around zero).
 */
import { format as d3format } from 'd3-format';
import { numberFormatter } from './number-format';
import type { DatasetColumn } from './dataset-shape';
import type { Row } from './dataflow';

export type SortDir = 'asc' | 'desc';
export interface SortSpec { col: string; dir: SortDir }

export interface DataTableColumnSpec {
  col: string;
  title?: string;
  /** d3-format specifier (numbers only; a non-number renders as text). */
  fmt?: string;
  align?: 'left' | 'right' | 'center';
  /** A proportional bar behind the value (numbers). `true` = the theme's chart color. */
  bar?: boolean | { color?: string };
  /** A tint by value: 'sequential' (0 → max) or 'diverging' (min ↔ 0 ↔ max). */
  colorScale?: 'sequential' | 'diverging';
  /** Fixed column width in px. */
  width?: number;
}

/** A column as the table will render it — the spec resolved against the table's real columns. */
export interface ResolvedColumn extends DataTableColumnSpec {
  type: DatasetColumn['type'];
  title: string;
  align: 'left' | 'right' | 'center';
  /** [min, max] over the loaded rows — what bars and scales are relative to. */
  range: [number, number] | null;
}

const ALIGNS = new Set(['left', 'right', 'center']);
const SCALES = new Set(['sequential', 'diverging']);

/** Parse the authored `columns` prop; unknown/malformed entries are dropped, and a spec naming a column the table lacks is kept (it renders empty and says so). */
export function parseColumnSpecs(raw: unknown): DataTableColumnSpec[] | null {
  if (!Array.isArray(raw)) return null;
  const out: DataTableColumnSpec[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.col !== 'string' || !e.col) continue;
    const spec: DataTableColumnSpec = { col: e.col };
    if (typeof e.title === 'string') spec.title = e.title;
    if (typeof e.fmt === 'string') spec.fmt = e.fmt;
    if (typeof e.align === 'string' && ALIGNS.has(e.align)) spec.align = e.align as DataTableColumnSpec['align'];
    if (e.bar === true) spec.bar = true;
    else if (e.bar && typeof e.bar === 'object' && !Array.isArray(e.bar)) {
      const color = (e.bar as { color?: unknown }).color;
      spec.bar = typeof color === 'string' ? { color } : true;
    }
    if (typeof e.colorScale === 'string' && SCALES.has(e.colorScale)) spec.colorScale = e.colorScale as DataTableColumnSpec['colorScale'];
    if (typeof e.width === 'number' && Number.isFinite(e.width) && e.width > 0) spec.width = e.width;
    out.push(spec);
  }
  return out;
}

/** Parse the authored `sort` prop. */
export function parseSortSpec(raw: unknown): SortSpec | null {
  if (typeof raw === 'string' && raw) return { col: raw, dir: 'asc' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { col?: unknown; dir?: unknown };
  if (typeof r.col !== 'string' || !r.col) return null;
  return { col: r.col, dir: r.dir === 'desc' ? 'desc' : 'asc' };
}

const numeric = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function rangeOf(rows: Row[], col: string): [number, number] | null {
  let min = Infinity;
  let max = -Infinity;
  for (const r of rows) {
    const n = numeric(r[col]);
    if (n === null) continue;
    if (n < min) min = n;
    if (n > max) max = n;
  }
  return min <= max ? [min, max] : null;
}

/** Resolve the columns to render: the spec (or every table column), typed, titled, aligned, ranged. */
export function resolveColumns(specs: DataTableColumnSpec[] | null, columns: DatasetColumn[], rows: Row[]): ResolvedColumn[] {
  const byName = new Map(columns.map((c) => [c.name, c]));
  const list: DataTableColumnSpec[] = specs ?? columns.map((c) => ({ col: c.name }));
  return list.map((spec) => {
    const type = byName.get(spec.col)?.type ?? 'string';
    return {
      ...spec,
      type,
      title: spec.title ?? spec.col,
      align: spec.align ?? (type === 'number' ? 'right' : 'left'),
      // Ranges are cheap and every numeric column may sort/bar/tint later.
      range: type === 'number' ? rangeOf(rows, spec.col) : null,
    };
  });
}

/** A stable sort by one column: numbers numerically, nulls last either way, strings by locale. */
export function sortRows(rows: Row[], sort: SortSpec | null): Row[] {
  if (!sort) return rows;
  const dir = sort.dir === 'desc' ? -1 : 1;
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => {
      const va = a.row[sort.col];
      const vb = b.row[sort.col];
      const na = va === null || va === undefined || va === '';
      const nb = vb === null || vb === undefined || vb === '';
      if (na && nb) return a.i - b.i;
      if (na) return 1;
      if (nb) return -1;
      const xa = numeric(va);
      const xb = numeric(vb);
      let cmp: number;
      if (xa !== null && xb !== null) cmp = xa - xb;
      else if (typeof va === 'boolean' && typeof vb === 'boolean') cmp = Number(va) - Number(vb);
      else cmp = collator.compare(String(va), String(vb));
      return cmp !== 0 ? cmp * dir : a.i - b.i;
    })
    .map((x) => x.row);
}

/** Cell text: d3-format when `fmt` is set and the value is a number, else the value's plain text ('' for null). */
export function formatCell(value: unknown, column: ResolvedColumn): string {
  if (value === null || value === undefined) return '';
  const n = numeric(value);
  if (n === null) return typeof value === 'object' ? JSON.stringify(value) : String(value);
  // An invalid `fmt` falls back to the default format (lib/story/number-format) — never a throw.
  return numberFormatter(column.fmt)(n);
}

/** Bar width as a fraction 0..1 of the column's max (magnitude); null when not a bar column / not a number. */
export function barFraction(value: unknown, column: ResolvedColumn): number | null {
  if (!column.bar || !column.range) return null;
  const n = numeric(value);
  if (n === null) return null;
  const maxAbs = Math.max(Math.abs(column.range[0]), Math.abs(column.range[1]));
  if (maxAbs === 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(n) / maxAbs));
}

const round = (x: number): number => Math.round(x * 100) / 100;

/**
 * Cell tint for a color-scale column, as a CSS color string using the theme's
 * chart variables (`--chart-1` for sequential, `--chart-2`/`--chart-1` for the
 * negative/positive halves of diverging) with an alpha proportional to the
 * value's position in the range; null when not applicable.
 */
export function cellTint(value: unknown, column: ResolvedColumn): string | null {
  if (!column.colorScale || !column.range) return null;
  const n = numeric(value);
  if (n === null) return null;
  const [min, max] = column.range;
  if (column.colorScale === 'sequential') {
    const t = max === min ? 1 : (n - min) / (max - min);
    return `rgb(from var(--chart-1) r g b / ${round(Math.max(0, Math.min(1, t)))})`;
  }
  if (n === 0) return null;
  const extent = Math.max(Math.abs(min), Math.abs(max)) || 1;
  const t = round(Math.min(1, Math.abs(n) / extent));
  return n < 0 ? `rgb(from var(--chart-2) r g b / ${t})` : `rgb(from var(--chart-1) r g b / ${t})`;
}

/** The virtual regime's row grid: one template shared by header and every row. */
export interface GridGeometry {
  /** `grid-template-columns` value. */
  template: string;
  /** The grid's total minimum width in px, null when no column has a known minimum. */
  minWidth: number | null;
}

/**
 * The track template for the virtualized rows, from the authored widths and a
 * one-time measurement of the static table's header cells (auto table layout
 * already sized every column to its content — the browser did the measuring).
 *
 * `minmax(<measured>px, 1fr)` keeps content width as a floor while still
 * stretching on a wide viewport; `minWidth` is what lets the grid grow PAST a
 * narrow one so the scroll box scrolls sideways — without it the rows'
 * `width: 100%` clamped the grid to a phone's screen, the tracks collapsed to
 * slivers, and every nowrap cell painted over its neighbours. A measurement
 * from a different column count is ignored: columns can change after the
 * one-time measure, and a stale floor under the wrong column is worse than none.
 */
export function gridGeometry(columns: ResolvedColumn[], measured: number[] | null): GridGeometry {
  const floors = measured && measured.length === columns.length ? measured : null;
  let minWidth = 0;
  const template = columns
    .map((c, i) => {
      if (c.width) {
        minWidth += c.width;
        return `${c.width}px`;
      }
      const floor = floors?.[i];
      if (typeof floor === 'number' && Number.isFinite(floor) && floor > 0) {
        const px = Math.ceil(floor);
        minWidth += px;
        return `minmax(${px}px, 1fr)`;
      }
      return 'minmax(0, 1fr)';
    })
    .join(' ');
  return { template, minWidth: minWidth > 0 ? minWidth : null };
}

// re-exported so the kit does not import d3 twice
const d3 = { format: d3format };

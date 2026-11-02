/** Internal: Parse, sort, format and measure table cells. Used by af-data-table. */
import { numberFormatter } from '@/lib/dataflow';
import type { DatasetColumn, Row } from '@/lib/dataflow';

type SortDir = 'asc' | 'desc';
export interface SortSpec {
  col: string;
  dir: SortDir;
}

interface DataTableColumnSpec {
  col: string;
  title?: string;
  fmt?: string;
  align?: 'left' | 'right' | 'center';
  bar?: boolean | { color?: string };
  colorScale?: 'sequential' | 'diverging';
  width?: number;
  kind?: 'image';
}
interface ResolvedColumn extends DataTableColumnSpec {
  type: DatasetColumn['type'];
  title: string;
  align: 'left' | 'right' | 'center';
  range: [number, number] | null;
}

const ALIGNS = new Set(['left', 'right', 'center']);
const SCALES = new Set(['sequential', 'diverging']);
const DEFAULT_TABLE_HEIGHT = 420;
export function parseTableHeight(raw: unknown, fallback: number = DEFAULT_TABLE_HEIGHT): number {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  if (typeof raw !== 'string') return fallback;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(raw);
  if (!m) return fallback;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
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
    if (typeof e.align === 'string' && ALIGNS.has(e.align))
      spec.align = e.align as DataTableColumnSpec['align'];
    if (e.bar === true) spec.bar = true;
    else if (e.bar && typeof e.bar === 'object' && !Array.isArray(e.bar)) {
      const color = (e.bar as { color?: unknown }).color;
      spec.bar = typeof color === 'string' ? { color } : true;
    }
    if (typeof e.colorScale === 'string' && SCALES.has(e.colorScale))
      spec.colorScale = e.colorScale as DataTableColumnSpec['colorScale'];
    if (typeof e.width === 'number' && Number.isFinite(e.width) && e.width > 0)
      spec.width = e.width;
    if (e.kind === 'image') spec.kind = 'image';
    out.push(spec);
  }
  return out;
}
export function parseSortSpec(raw: unknown): SortSpec | null {
  if (typeof raw === 'string' && raw) return { col: raw, dir: 'asc' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as { col?: unknown; dir?: unknown };
  if (typeof r.col !== 'string' || !r.col) return null;
  return { col: r.col, dir: r.dir === 'desc' ? 'desc' : 'asc' };
}

const numeric = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

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
export function resolveColumns(
  specs: DataTableColumnSpec[] | null,
  columns: DatasetColumn[],
  rows: Row[],
): ResolvedColumn[] {
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
export function formatCell(value: unknown, column: Pick<ResolvedColumn, 'fmt'>): string {
  if (value === null || value === undefined) return '';
  const n = numeric(value);
  if (n === null) return typeof value === 'object' ? JSON.stringify(value) : String(value);
  // An invalid `fmt` falls back to the default format (lib/dataflow/number-format) — never a throw.
  return numberFormatter(column.fmt)(n);
}
export function barFraction(value: unknown, column: ResolvedColumn): number | null {
  if (!column.bar || !column.range) return null;
  const n = numeric(value);
  if (n === null) return null;
  const maxAbs = Math.max(Math.abs(column.range[0]), Math.abs(column.range[1]));
  if (maxAbs === 0) return 0;
  return Math.min(1, Math.max(0, Math.abs(n) / maxAbs));
}

const round = (x: number): number => Math.round(x * 100) / 100;
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
export interface GridGeometry {
  template: string;
  minWidth: number | null;
}
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

/**
 * `<DataTable transpose>` — the pure half of a comparison table: items as columns, measures as rows.
 *
 *   <DataTable data="$picks" transpose header="name" edge metrics={[
 *     {"col":"cost","title":"Cost per run","fmt":"$,.2f","better":"low","rank":"cost_rank","sub":"cost_range"},
 *     {"col":"score","title":"Score (of 34)","fmt":".1f","better":"high"}]} />
 *
 * Each query row becomes a column headed by its `header` cell; each metric becomes a row. `better`
 * (`high`|`low`) marks the best value when at least two items have one (ties mark all); `rank` names
 * a column drawn as a small `#n` after the value, `sub` a column drawn as a line under it. `edge`
 * adds a last column: "<winner> by N%" over the runner-up (100·|a−b|/min(|a|,|b|), rounded), with
 * " vs <runner-up>" when more than two values compete, "tied: A, B" on a tie at the top, nothing with
 * fewer than two values. Nulls draw "–" and never win.
 *
 * Values format through DataTable's own `formatCell`, so a `fmt` reads the same in both layouts.
 * No DOM: the kit's ComparisonGrid renders what this computes.
 */
import { formatCell } from './data-table';
import { COMPARE_DIRECTIONS, MAX_COMPARE_ITEMS } from '@/lib/jsx/comparison';
import type { DatasetColumn, Row } from '@/lib/dataflow';

export { MAX_COMPARE_ITEMS };
/** What a missing value draws. */
const COMPARE_EMPTY = '–';

interface CompareMetricSpec {
  col: string;
  title?: string;
  /** d3-format specifier, as DataTable `columns[].fmt`. */
  fmt?: string;
  /** Which direction wins: the best value per metric is drawn bold and named in the edge. */
  better?: 'high' | 'low';
  /** A column whose value is drawn as `#n` after the cell. */
  rank?: string;
  /** A column whose value is drawn as a small line under the cell. */
  sub?: string;
}

interface CompareCell { text: string; best: boolean; rank: string | null; sub: string | null }
/** The edge text in two parts, so the winner (or "tied") can be emphasised: `lead + rest` is the whole. */
interface CompareEdge { lead: string; rest: string }
interface CompareRow { col: string; title: string; cells: CompareCell[]; edge: CompareEdge | null }
interface Comparison {
  /** Each shown item's header text, in row order. */
  items: string[];
  /** How many rows the table had: more than `items.length` when the cap left some out. */
  total: number;
  rows: CompareRow[];
}

const DIRECTIONS = new Set<string>(COMPARE_DIRECTIONS);
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Parse the authored `metrics` prop; malformed entries and unknown fields are dropped. */
export function parseMetricSpecs(raw: unknown): CompareMetricSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: CompareMetricSpec[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (!text(e.col)) continue;
    const spec: CompareMetricSpec = { col: e.col };
    if (typeof e.title === 'string') spec.title = e.title;
    if (typeof e.fmt === 'string') spec.fmt = e.fmt;
    if (typeof e.better === 'string' && DIRECTIONS.has(e.better)) spec.better = e.better as CompareMetricSpec['better'];
    if (text(e.rank)) spec.rank = e.rank;
    if (text(e.sub)) spec.sub = e.sub;
    out.push(spec);
  }
  return out;
}

const numeric = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const empty = (v: unknown): boolean => v === null || v === undefined || v === '';
const plain = (v: unknown): string => formatCell(v, {});

function rankText(v: unknown): string | null {
  if (empty(v)) return null;
  const s = plain(v);
  return s.startsWith('#') ? s : `#${s}`;
}

/** The edge over the values that compete (best first), or null when fewer than two do. */
function edgeOf(values: Array<{ name: string; n: number }>, better: 'high' | 'low'): CompareEdge | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => (better === 'high' ? b.n - a.n : a.n - b.n));
  const top = sorted[0]!.n;
  const tied = sorted.filter((v) => v.n === top);
  if (tied.length > 1) return { lead: 'tied', rest: `: ${tied.map((v) => v.name).join(', ')}` };
  const a = sorted[0]!;
  const b = sorted[1]!;
  const base = Math.min(Math.abs(a.n), Math.abs(b.n));
  // A zero leaves no ratio to state: the winner is named without one.
  const by = base === 0 ? '' : ` by ${Math.round((100 * Math.abs(a.n - b.n)) / base)}%`;
  return { lead: a.name, rest: `${by}${values.length > 2 ? ` vs ${b.name}` : ''}` };
}

/**
 * The comparison a transposed DataTable draws, from its table and its authored props. Without a `header`
 * the first text column heads the items; without `metrics` every other column is one.
 */
export function compareTable(input: { rows: Row[]; columns: DatasetColumn[]; header?: string; metrics?: CompareMetricSpec[] | null; edge?: boolean; max?: number }): Comparison {
  const header = input.header || (input.columns.find((c) => c.type === 'string')?.name ?? input.columns[0]?.name ?? '');
  const shown = input.rows.slice(0, input.max ?? MAX_COMPARE_ITEMS);
  const items = shown.map((row) => (empty(row[header]) ? COMPARE_EMPTY : plain(row[header])));
  const metrics: CompareMetricSpec[] = input.metrics ?? input.columns.filter((c) => c.name !== header).map((c) => ({ col: c.name }));
  const rows = metrics.map((metric): CompareRow => {
    const values = shown.flatMap((row, i) => { const n = numeric(row[metric.col]); return n === null ? [] : [{ name: items[i]!, n }]; });
    const best = metric.better && values.length >= 2
      ? (metric.better === 'high' ? Math.max : Math.min)(...values.map((v) => v.n))
      : null;
    const cells = shown.map((row): CompareCell => {
      const value = row[metric.col];
      return {
        text: empty(value) ? COMPARE_EMPTY : formatCell(value, metric),
        best: best !== null && numeric(value) === best,
        rank: metric.rank ? rankText(row[metric.rank]) : null,
        sub: metric.sub && !empty(row[metric.sub]) ? plain(row[metric.sub]) : null,
      };
    });
    return { col: metric.col, title: metric.title ?? metric.col, cells, edge: input.edge && metric.better ? edgeOf(values, metric.better) : null };
  });
  return { items, total: input.rows.length, rows };
}

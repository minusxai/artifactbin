"use client"

/**
 * `<DataTable>` — the data-bound table of the story kit, and the ONE way to
 * show a lot of rows: virtualised (only the visible window is in the DOM),
 * declarative per-column formatting (lib/story/data-table), sortable by
 * header, and honest about being a sample — a table over a query cut at the
 * row cap says "N of M" and can read the rest a window at a time, sorted by
 * the engine, through the store's page transport.
 *
 * Two render regimes, deliberately: before mount (SSR, the og export, and
 * the first client render — so hydration matches) it is a
 * plain table of the first rows inside a height-capped scroll box; after mount,
 * with a measured height, the same box becomes a virtual window. Chrome is
 * token classes only (this file is globbed into the recipe union).
 */
import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

import { cn } from "./cn"
import {
  barFraction, cellTint, formatCell, gridGeometry, parseColumnSpecs, parseTableHeight, resolveColumns, sortRows,
  type DataTableColumnSpec, type ResolvedColumn, type SortSpec,
} from "@/lib/story/data-table"
import type { DatasetColumn } from "@/lib/story/dataset-shape"
import type { Row } from "@/lib/story/dataflow"
import type { JsxNode } from "@/lib/jsx"
import { AST_PATH_ATTR } from "@/lib/story-ui/ast-path"

export interface ColumnTemplate { col: string; title?: string; props: Record<string, unknown>; nodes: JsxNode[]; path: string }

export interface DataTableProps {
  /** Absent (the bare registry entry, with no adapter) renders the empty state. */
  rows?: Row[]
  columns?: DatasetColumn[]
  /** The authored `columns` prop, parsed (lib/story/data-table parseColumnSpecs). Absent = every column. */
  spec?: DataTableColumnSpec[] | null
  /** Initial sort. */
  sort?: SortSpec | null
  /**
   * The scroll box CEILING in px; default 420. Accepts a number or the string
   * the docs teach (`420` or `"420px"`). Short tables hug their rows — the box
   * is a maximum, never a reserved height.
   */
  height?: number | string
  /** Sticky header (default true). */
  sticky?: boolean
  /** The real row count when `rows` is a sample (the engine's cap, or a page). */
  totalRows?: number
  truncated?: boolean
  /** A window read is in flight. */
  loading?: boolean
  /**
   * When the rows are a SAMPLE, sorting cannot be done locally without lying:
   * the caller re-reads with this sort. Absent, sorting is local.
   */
  onSortChange?: (sort: SortSpec | null) => void
  /** When the rows are a sample: read the next window. */
  onLoadMore?: () => void
  /**
   * Where a cell in an `image` column is SERVED from — the document's own
   * mapping of a web URL to our copy of it (lib/story/asset-url
   * `runtimeAssetUrl`, supplied by the runtime's DataTable adapter). Null means
   * there is nowhere to import it through, and the cell stays text: this
   * component never reaches a third-party host on a reader's behalf, which is
   * the whole point of the asset store above it.
   */
  resolveSrc?: (url: string) => string | null
  rowKey?: string
  templates?: ColumnTemplate[]
  renderCell?: (template: ColumnTemplate, row: Row) => React.ReactNode
  className?: string
  /**
   * Unknown props reach the root div, like every other kit component — the
   * interpreter's `data-mx-ast` stamp among them, which is what makes an
   * authored <DataTable> selectable in edit mode. Destructuring everything
   * and spreading nothing silently dropped it.
   */
  [key: `data-${string}`]: unknown
}

/** Rows SSR'd / rendered before the virtual window takes over. */
const STATIC_ROWS = 50
const ROW_H = 33

export function DataTable({
  rows = [], columns = [], spec = null, sort: initialSort = null, height, sticky = true,
  totalRows, truncated = false, loading = false, onSortChange, onLoadMore, resolveSrc, rowKey, templates = [], renderCell, className, ...props
}: DataTableProps) {
  // A CEILING, not a reserved height: a three-row table hugs its rows and a
  // long one scrolls inside the cap, because `overflow-auto` gives the
  // virtualizer's scroll element clientHeight = min(content, boxHeight).
  const boxHeight = parseTableHeight(height)

  const [sort, setSort] = React.useState<SortSpec | null>(initialSort)
  React.useEffect(() => { setSort(initialSort) }, [initialSort?.col, initialSort?.dir]) // eslint-disable-line react-hooks/exhaustive-deps

  const resolved = React.useMemo(() => resolveColumns(
    templates.length ? parseColumnSpecs(templates.map((template) => template.props)) : spec,
    columns, rows,
  ), [spec, columns, rows, templates])
  const remote = truncated && !!onSortChange
  const ordered = React.useMemo(() => (remote ? rows : sortRows(rows, sort)), [rows, sort, remote])

  const cycle = (col: string) => {
    const next: SortSpec | null = !sort || sort.col !== col ? { col, dir: 'asc' } : sort.dir === 'asc' ? { col, dir: 'desc' } : null
    setSort(next)
    if (remote) onSortChange?.(next)
  }

  // Virtual only once mounted AND measured: jsdom and SSR have no size, and
  // the first client render must equal the server's markup. The header cells
  // are measured in the same breath, while the static table's auto layout is
  // still on screen — those widths become the virtual grid's track floors.
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [virtual, setVirtual] = React.useState(false)
  const [measured, setMeasured] = React.useState<number[] | null>(null)
  React.useEffect(() => {
    const el = scrollRef.current
    if (!el || el.clientHeight === 0) return
    setMeasured([...el.querySelectorAll('thead th')].map((th) => th.getBoundingClientRect().width))
    setVirtual(true)
  }, [])
  const virtualizer = useVirtualizer({
    count: ordered.length,
    getItemKey: (index) => rowIdentity(ordered[index], rowKey, index),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    enabled: virtual,
  })
  const items = virtualizer.getVirtualItems()
  const total = virtualizer.getTotalSize()

  // Near the bottom of a sample: ask for the next window once per approach.
  const askedAtRef = React.useRef(-1)
  const onScroll = () => {
    const el = scrollRef.current
    if (!el || !truncated || !onLoadMore || loading) return
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_H * 6 && askedAtRef.current !== ordered.length) {
      askedAtRef.current = ordered.length
      onLoadMore()
    }
  }

  const visible: Array<{ index: number; start: number | null }> = virtual
    ? items.map((v) => ({ index: v.index, start: v.start }))
    : ordered.slice(0, STATIC_ROWS).map((_, i) => ({ index: i, start: null }))

  // In the virtual regime every row is positioned on its own, so a shared
  // TABLE layout no longer keeps columns aligned with the header: header row
  // and body rows all become the same CSS grid instead — one template, so a
  // cell sits under its heading by construction. The measured floors and the
  // shared minWidth let the grid grow past a narrow viewport, handing overflow
  // to the scroll box — the page never scrolls sideways, the table does.
  const geometry = gridGeometry(resolved, measured)
  const rowGrid: React.CSSProperties | undefined = virtual
    ? { display: 'grid', gridTemplateColumns: geometry.template, width: '100%', ...(geometry.minWidth ? { minWidth: `${geometry.minWidth}px` } : {}) }
    : undefined

  const count = new Intl.NumberFormat(undefined)
  if (rowKey) {
    const seen = new Set<string>()
    for (const row of rows) {
      const value = row[rowKey]
      if (value == null || (typeof value !== 'string' && typeof value !== 'number') || (typeof value === 'number' && !Number.isFinite(value))) return <div role="alert">rowKey must have a non-null string or number for every row</div>
      const key = `${typeof value}:${value}`
      if (seen.has(key)) return <div role="alert">rowKey must be unique; duplicate key {String(value)}</div>
      seen.add(key)
    }
  }
  return (
    <div data-slot="data-table" aria-label="Data grid" className={cn("flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-card text-sm", className)} {...props}>
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative min-h-0 w-full flex-1 overflow-auto"
        style={{ maxHeight: `${boxHeight}px` }}
      >
        <table className="w-full border-collapse text-sm" style={virtual ? { display: 'block' } : undefined}>
          <thead className={cn("bg-card text-left text-muted-foreground", sticky && "sticky top-0 z-10")} style={virtual ? { display: 'block' } : undefined}>
            <tr className="border-b border-border" style={rowGrid}>
              {resolved.map((c) => {
                const template = templates.find((candidate) => candidate.col === c.col)
                return (
                <th
                  key={c.col}
                  id={typeof template?.props.id === 'string' ? template.props.id : undefined}
                  {...{ [AST_PATH_ATTR]: template?.path }}
                  scope="col"
                  aria-label={`Sort by ${c.title}`}
                  aria-sort={sort?.col === c.col ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  title={c.type === 'string' && !columns.some((k) => k.name === c.col) ? `"${c.col}" is not a column of this table` : undefined}
                  onClick={() => cycle(c.col)}
                  className="cursor-pointer select-none whitespace-nowrap px-3 py-2 font-bold"
                  style={{ textAlign: c.align, width: c.width ? `${c.width}px` : undefined }}
                >
                  {c.title}
                  {sort?.col === c.col ? <span aria-hidden="true" className="ml-1 opacity-70">{sort.dir === 'asc' ? '▲' : '▼'}</span> : null}
                </th>
                )
              })}
            </tr>
          </thead>
          <tbody style={virtual ? { display: 'block', height: `${total}px`, position: 'relative' } : undefined}>
            {ordered.length === 0 ? (
              <tr style={virtual ? { display: 'block' } : undefined}><td colSpan={Math.max(1, resolved.length)} className="block px-3 py-6 text-center text-muted-foreground">no rows</td></tr>
            ) : visible.map(({ index, start }) => (
              <DataRow
                key={rowIdentity(ordered[index], rowKey, index)}
                row={ordered[index]}
                columns={resolved}
                style={start === null ? undefined : { ...rowGrid, position: 'absolute', top: 0, left: 0, transform: `translateY(${start}px)` }}
                measure={virtual ? virtualizer.measureElement : undefined}
                index={index}
                resolveSrc={resolveSrc}
                templates={templates}
                renderCell={renderCell}
              />
            ))}
          </tbody>
        </table>
      </div>
      {(truncated || loading || (totalRows !== undefined && totalRows > rows.length)) && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-3 py-1.5 text-xs text-muted-foreground">
          <span aria-label="Row count">
            {loading ? 'loading rows…' : `${count.format(rows.length)} of ${count.format(totalRows ?? rows.length)} rows`}
          </span>
          {truncated && onLoadMore && !loading && (
            <button type="button" aria-label="Load more rows" onClick={onLoadMore} className="cursor-pointer font-medium underline-offset-2 hover:underline">
              load more
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function DataRow({ row, columns, style, measure, index, resolveSrc, templates, renderCell }: {
  row: Row
  columns: ResolvedColumn[]
  style?: React.CSSProperties
  measure?: (el: HTMLElement | null) => void
  index: number
  resolveSrc?: (url: string) => string | null
  templates: ColumnTemplate[]
  renderCell?: (template: ColumnTemplate, row: Row) => React.ReactNode
}) {
  return (
    <tr ref={measure} data-index={index} className="border-b border-border/50 transition-colors hover:bg-muted/30" style={style}>
      {columns.map((c) => {
        const value = row[c.col]
        const bar = barFraction(value, c)
        const tint = cellTint(value, c)
        return (
          <td
            key={c.col}
            className={cn("relative whitespace-nowrap px-3 py-1.5 align-middle", c.type === 'number' && "tabular-nums")}
            style={{ textAlign: c.align, width: c.width ? `${c.width}px` : undefined, ...(tint ? { background: tint } : {}) }}
          >
            {bar !== null && (
              <span
                data-bar=""
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-1 left-1 rounded-sm opacity-25"
                style={{ width: `${Math.round(bar * 100)}%`, background: typeof c.bar === 'object' && c.bar.color ? c.bar.color : 'var(--chart-1)' }}
              />
            )}
            <span className="relative">{(() => { const template = templates.find((t) => t.col === c.col); return template && template.nodes.some((n) => n.type !== 'text' || n.value.trim()) && renderCell ? renderCell(template, row) : imageCell(value, c, resolveSrc) ?? formatCell(value, c); })()}</span>
          </td>
        )
      })}
    </tr>
  )
}

function rowIdentity(row: Row, key: string | undefined, index: number): string {
  const value = key ? row[key] : undefined;
  return value === null || value === undefined || (typeof value !== 'string' && typeof value !== 'number')
    ? `index:${index}` : `${typeof value}:${String(value)}`;
}

/**
 * The one non-text cell: an `image` column's URL, drawn from OUR copy.
 *
 * Null for everything else — a column the author did not mark, a cell that is
 * not a web URL, or a render with no mapping behind it — and the caller then
 * formats it as text. `loading="lazy"` because a table is exactly the shape
 * that puts fifty pictures below the fold.
 */
function imageCell(value: unknown, c: ResolvedColumn, resolveSrc?: (url: string) => string | null): React.ReactNode | null {
  if (c.kind !== 'image' || typeof value !== 'string' || !/^https?:\/\//i.test(value)) return null
  const src = resolveSrc?.(value) ?? null
  if (!src) return null
  return <img src={src} alt="" loading="lazy" className="inline-block max-h-8 w-auto align-middle" />
}

/** The `data-table` kit chunk: `<DataTable>` (and its `<Column>` templates), the live, paged, editable table. */
import { useContext, useMemo, useRef, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react';
import { DataTable, type ColumnTemplate } from '@/components/kit/data-table';
import { GridItemContext } from '@/components/kit/grid';
import { parseColumnSpecs, parseSortSpec, parseTableHeight, type SortSpec } from '@/lib/story/data-table';
import { refName, type Row, type TableResult } from '@/lib/story/dataflow';
import { isWebUrl, runtimeAssetUrl } from '@/lib/story/asset-url';
import { createCellSessions } from '../cell-sessions';
import { CellSessionsContext, RuntimeAssetContext, RuntimeEmbedContext, runtimeTargetIdentity } from '../runtime-context';
import type { KitChunk } from '../kit-registry';

const TABLE_PAGE = 500;

/**
 * `<DataTable data="$name" columns sort height sticky>` — the live table. Its
 * rows are the store's until the reader asks for more of a truncated result:
 * then windows come through the store's page transport (sorted by the engine,
 * because sorting a sample locally would lie) and are held here. A store
 * update (a value changed, the query re-ran) resets to the store's rows.
 */
function DataTableAdapter(props: Record<string, unknown>) {
  const ctx = useContext(RuntimeEmbedContext);
  // An `image` column's cells go through the SAME mapping a bound <img src>
  // does — one function, so a URL in a table and a URL in the markup are
  // served from the same place and imported through the same door.
  const { endpoint, seen } = useContext(RuntimeAssetContext);
  const resolveSrc = useMemo(() => (url: string) => {
    // Null both ways: the mapping refused the value, or there is no endpoint to
    // import a web URL through. Either way the cell stays text (kit data-table).
    const mapped = runtimeAssetUrl(url, (u) => seen.has(u), endpoint);
    return mapped === url && isWebUrl(url) ? null : mapped;
  }, [endpoint, seen]);
  // Same cell contract as QuestionAdapter: inside a GridItem the cell sizes the embed.
  const inGridItem = useContext(GridItemContext);
  const name = refName(props.data);
  const table = name ? ctx.state.tables[name] : undefined;
  const spec = useMemo(() => parseColumnSpecs(props.columns), [props.columns]);
  const authoredSort = useMemo(() => parseSortSpec(props.sort), [props.sort]);
  const templates = Array.isArray(props.templates) ? props.templates as ColumnTemplate[] : [];
  const sessions = useMemo(() => createCellSessions(), []);
  // A CEILING, not a reserved height (the kit's scroll box caps itself): outside a
  // grid cell the wrapper leaves the table to hug its rows, and the cap is the TABLE
  // parser's — questionEmbedHeightPx floors at MIN_CHART_H, a chart rule that would
  // turn an authored height="120px" into a 340px box.
  const cap = parseTableHeight(props.height);
  const wrapper: CSSProperties = inGridItem ? { width: '100%', height: '100%' } : { width: '100%' };

  const [extra, setExtra] = useState<{ base: TableResult | undefined; rows: Row[]; sort: SortSpec | null; loading: boolean; replaced: boolean }>({ base: table, rows: [], sort: authoredSort, loading: false, replaced: false });
  const paged = extra.base === table ? extra : { base: table, rows: [], sort: authoredSort, loading: false, replaced: false };
  // Two quick header clicks are two window reads; only the LATEST may land.
  const readSeq = useRef(0);

  const readWindow = (offset: number, sort: SortSpec | null, replace: boolean) => {
    if (!name || !table) return;
    const seq = ++readSeq.current;
    setExtra({ base: table, rows: replace ? [] : paged.rows, sort, loading: true, replaced: replace || paged.replaced });
    ctx.fetchPage(name, { offset, limit: TABLE_PAGE, sort: sort ?? undefined }).then(
      (win) => { if (seq === readSeq.current) setExtra((prev) => (prev.base === table ? { base: table, rows: replace ? win.rows : [...prev.rows, ...win.rows], sort, loading: false, replaced: replace || prev.replaced } : prev)); },
      () => { if (seq === readSeq.current) setExtra((prev) => (prev.base === table ? { ...prev, loading: false } : prev)); },
    );
  };

  if (!table) {
    const error = name ? ctx.state.errors[name] : undefined;
    const pending = name !== null && ctx.pending.has(name);
    return (
      <div {...runtimeTargetIdentity(props)} aria-label="DataTable embed" className="flex w-full flex-col items-center justify-center gap-2.5 rounded-md border border-border p-4 text-sm text-muted-foreground" style={wrapper}>
        {/* Pending speaks the platform loading lockup (see QuestionEmbed's `waiting`). */}
        {pending ? (
          <>
            <span aria-hidden="true" className="size-[22px] animate-spin rounded-full border-2 border-border border-t-primary motion-reduce:animate-none" />
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">loading data…</span>
          </>
        ) : !name ? 'data unavailable — bind a declared table with data="$name"'
          : error ? `query "${name}" failed: ${error}`
          : `data unavailable — "$${name}" has no rows yet`}
      </div>
    );
  }
  const truncated = !!table.truncated;
  // A load-more window APPENDS to the sample; a re-read REPLACES it, so the rows
  // on screen are exactly the engine's order for that read. Which one happened is
  // carried on the window itself — the SORT cannot stand in for it, because
  // cycling a sort back off (asc -> desc -> none) is a replacing read whose sort
  // is null, and appending that window to the sample duplicates every row.
  const shown = paged.replaced && paged.rows.length ? paged.rows : [...table.rows, ...paged.rows];
  const busy = name !== null && ctx.pending.has(name);
  // Cell sessions already indicate saving and retain drafts during refresh.
  // Keep the rest of an editable table visually stable and available to edit.
  const dimRefresh = busy && templates.length === 0;
  return (
    <div {...runtimeTargetIdentity(props)} aria-label="DataTable embed" aria-busy={busy} className={dimRefresh ? 'mx-busy' : undefined} style={wrapper}>
      <CellSessionsContext.Provider value={sessions}><DataTable
        commentOwner={typeof props.id === 'string' ? props.id : undefined}
        rows={shown}
        columns={table.columns}
        people={ctx.state.people}
        spec={spec}
        rowKey={typeof props.rowKey === 'string' ? props.rowKey : undefined}
        templates={templates}
        renderCell={typeof props.renderCell === 'function' ? props.renderCell as (template: ColumnTemplate, row: Row) => ReactNode : undefined}
        sort={authoredSort}
        height={cap}
        sticky={props.sticky !== false}
        totalRows={table.totalRows}
        truncated={truncated}
        loading={paged.loading}
        resolveSrc={resolveSrc}
        onSortChange={truncated ? (sort) => readWindow(0, sort, true) : undefined}
        onLoadMore={truncated ? () => readWindow(shown.length, paged.sort, false) : undefined}
      /></CellSessionsContext.Provider>
    </div>
  );
}

export const chunk: KitChunk = {
  // Registered bare for completeness; the runtime supplies rows through its adapter, while an inert render draws a placeholder.
  // `Column` is template-only: DataTable's interpreter seam consumes it.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  faces: { DataTable: DataTable as unknown as ComponentType<any>, Column: (() => null) as ComponentType<unknown> },
  live: { DataTable: DataTableAdapter },
};

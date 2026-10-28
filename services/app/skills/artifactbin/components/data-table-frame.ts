/**
 * Internal: af-data-table instance state, server paging (loadMore), styles and the shared frame
 *   (scroll viewport, table, footer) that hands off to the grid or comparison renderer.
 * Used by: data-table.ts (state type also by data-table-grid/-cells/-compare/-measure.ts).
 */
import { parseTableHeight, type SortSpec } from "@/lib/story-ui/data-table";
import type { AfDataTable } from "./data-table";
import { renderComparison } from "./data-table-compare";
import { renderGrid } from "./data-table-grid";
import {
  DATA_TABLE_CLASSES,
  TableLoader,
  type TableColumnIdentity,
  type TableData,
  type TableSource,
  type TableCellRenderer,
  type TableTemplate,
} from "./table-model";
/** Everything the element mutates; one record so the render modules can share it. */
export interface TableState {
  value: TableData;
  specs: unknown;
  headerIdentities: Readonly<Record<string, TableColumnIdentity>>;
  order: SortSpec | null;
  renderers: Record<string, TableCellRenderer>;
  templateList: TableTemplate[];
  metricSpecs: unknown;
  loader: TableLoader;
  transport?: TableSource;
  showRowCount: boolean;
  pending: boolean;
  // Bumped on every cancel; a loadMore whose epoch is stale must not touch pending/error.
  requestEpoch: number;
  instancePrefix: string;
  error: string;
  table?: HTMLTableElement;
  viewport?: HTMLDivElement;
  viewportObserver?: ResizeObserver;
  rowObserver?: ResizeObserver;
  rowHeights: Map<string, number>;
  measuredHeaderWidths: number[] | null;
  columnSignature: string;
  virtualized: boolean;
  columnsNeedMeasurement: boolean;
  virtualizationPending: boolean;
  footer?: HTMLDivElement;
  rows: Map<string, HTMLTableRowElement>;
  comparisonRows: Map<string, HTMLTableRowElement>;
  heads: Map<string, HTMLTableCellElement>;
  ids: Map<string, string>;
  serial: number;
  cellModes: WeakMap<HTMLElement, unknown>;
  render: () => void;
}
let tableSequence = 0;
export const emptyTable = (): TableData => ({ rows: [], columns: [] });
export function createTableState(render: () => void): TableState {
  return {
    value: emptyTable(), specs: null, headerIdentities: {}, order: null, renderers: {},
    templateList: [], metricSpecs: undefined, loader: new TableLoader(), showRowCount: false,
    pending: false, requestEpoch: 0, instancePrefix: `af-table-${++tableSequence}`, error: "",
    rowHeights: new Map(), measuredHeaderWidths: null, columnSignature: "", virtualized: false,
    columnsNeedMeasurement: false, virtualizationPending: false, rows: new Map(),
    comparisonRows: new Map(), heads: new Map(), ids: new Map(), serial: 0,
    cellModes: new WeakMap(), render,
  };
}
const hasMoreRows = (data: TableData) =>
  data.truncated || (data.totalRows ?? 0) > data.rows.length;
export async function loadTableRows(
  el: AfDataTable, s: TableState, replace: boolean,
): Promise<void> {
  if (!el.source || s.pending) return;
  if (!replace && !hasMoreRows(el.data)) return;
  const epoch = ++s.requestEpoch;
  s.pending = true;
  s.error = "";
  s.render();
  try {
    // The loader returns undefined when a newer read superseded this one.
    const result = await s.loader.read(el.source, {
      offset: replace ? 0 : el.data.rows.length,
      limit: 500,
      sort: el.sort,
    });
    if (!result) return;
    const rows = replace ? result.rows : [...el.data.rows, ...result.rows];
    s.showRowCount = Boolean(
      s.showRowCount || result.truncated || (result.totalRows ?? 0) > rows.length,
    );
    s.value = { ...result, rows };
  } catch (e) {
    if (epoch === s.requestEpoch)
      s.error = e instanceof Error ? e.message : "Unable to load rows";
  } finally {
    if (epoch === s.requestEpoch) {
      s.pending = false;
      s.render();
    }
  }
}
export function renderTable(el: AfDataTable, s: TableState) {
  if (!el.isConnected) return;
  const document = el.ownerDocument;
  // Captured before any DOM moves so the grid path can restore focus afterwards.
  const focused = el.contains(el.ownerDocument.activeElement)
    ? (el.ownerDocument.activeElement as HTMLElement)
    : null;
  if (!s.table) {
    el.dataset.slot = "data-table";
    s.viewport = document.createElement("div");
    s.viewport.dataset.slot = "table-scroll";
    s.table = document.createElement("table");
    s.table.className = DATA_TABLE_CLASSES.table;
    s.table.setAttribute("data-mx-kit-table", "");
    s.table.createTHead().insertRow();
    s.table.createTBody();
    s.viewport.append(s.table);
    s.footer = document.createElement("div");
    s.footer.dataset.slot = "table-footer";
    s.footer.setAttribute("aria-live", "polite");
    el.append(s.viewport, s.footer);
    s.viewport.addEventListener("scroll", () => {
      s.render();
      const viewport = s.viewport!;
      // Infinite scroll: page in more server rows within 216px of the bottom.
      if (
        !el.transpose && el.source && !s.pending &&
        (el.data.truncated || (el.data.totalRows ?? 0) > el.data.rows.length) &&
        viewport.clientHeight > 0 &&
        viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 216
      )
        void el.loadMore();
    });
  }
  if (!s.viewportObserver && typeof ResizeObserver !== "undefined") {
    s.viewportObserver = new ResizeObserver(() => s.render());
    s.viewportObserver.observe(s.viewport!);
  }
  const table = s.table, body = table.tBodies[0]!, head = table.tHead!.rows[0]!;
  table.setAttribute(
    "aria-label",
    el.getAttribute("label") ?? (el.transpose ? "Comparison table" : "Data grid"),
  );
  table.setAttribute("aria-busy", String(s.pending));
  s.viewport!.style.maxHeight = `${parseTableHeight(el.height)}px`;
  table.tHead!.style.position = el.sticky ? "sticky" : "";
  table.tHead!.style.top = "0";
  s.footer!.replaceChildren();
  if (s.error) {
    const alert = document.createElement("span");
    alert.setAttribute("role", "alert");
    alert.textContent = s.error;
    s.footer!.append(alert);
  }
  const layout = el.transpose ? "comparison" : "grid";
  if (table.dataset.layout && table.dataset.layout !== layout) {
    head.replaceChildren();
    body.replaceChildren();
    s.viewport!.scrollTop = 0;
  }
  table.dataset.layout = layout;
  if (el.transpose) renderComparison(el, s, table, head, body);
  else renderGrid(el, s, table, head, body, focused);
}
/** Light-DOM styles, injected once per document when data-table.ts registers. */
export const dataTableStyles =
  "af-data-table{display:flex;flex-direction:column;width:100%;min-width:0;" +
  "box-sizing:border-box;overflow:hidden;border:1px solid var(--border,#ddd);" +
  "border-radius:var(--radius,.375rem);background:var(--card,var(--background,#fff));" +
  "color:var(--foreground,#222);font:inherit;font-size:.875rem;" +
  "line-height:1.4285714285714286}af-data-table[data-af-fill]{height:100%}" +
  "af-data-table [data-slot=table-scroll]{flex:1 1 auto;width:100%;overflow:auto;" +
  "position:relative;min-height:0}af-data-table table.af-data-table__table{display:table;" +
  "width:100%;max-width:none;border-collapse:collapse;font-size:inherit;" +
  "line-height:inherit}af-data-table thead{background:var(--card,var(--background,#fff));" +
  "color:var(--muted-foreground,#666);z-index:1}" +
  "af-data-table th.af-data-table__header-cell{min-width:0;overflow:hidden;" +
  "text-overflow:ellipsis;text-align:left;padding:.5rem .75rem;font-weight:700;" +
  "white-space:nowrap;border-bottom:1px solid var(--border,#ddd);cursor:pointer}" +
  "af-data-table th.af-data-table__header-cell:focus-visible{outline:2px solid var(--ring," +
  "#777);outline-offset:-2px}af-data-table td.af-data-table__cell{position:relative;" +
  "min-width:0;overflow:hidden;padding:.375rem .75rem;white-space:nowrap;" +
  "border-bottom:1px solid color-mix(in srgb,var(--border,#ddd) 50%,transparent);" +
  "box-sizing:border-box;vertical-align:middle}" +
  "af-data-table tbody tr:hover{background:color-mix(in srgb,var(--muted,#eee) 30%," +
  "transparent)}af-data-table [data-bar]{position:absolute;top:.25rem;bottom:.25rem;" +
  "left:.25rem;opacity:.25;pointer-events:none;border-radius:.125rem}" +
  "af-data-table table[data-layout=comparison] th:first-child{position:sticky;left:0;" +
  "z-index:1;background:var(--card,var(--background,#fff))}" +
  "af-data-table [data-slot=cell-content]{position:relative}" +
  "af-data-table small{display:block;color:var(--muted-foreground,#666)}" +
  "af-data-table [data-slot=table-footer]:not(:empty){display:flex;align-items:center;" +
  "justify-content:space-between;gap:.75rem;border-top:1px solid var(--border,#ddd);" +
  "padding:.375rem .75rem;font-size:.75rem;color:var(--muted-foreground,#666)}";

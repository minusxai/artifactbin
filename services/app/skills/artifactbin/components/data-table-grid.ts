/**
 * Internal: af-data-table grid layout: sortable header cells, keyed row window (virtualized after
 *   the first natural-layout pass), column measurement and the row-count/load-more footer.
 * Used by: data-table-frame.ts.
 */
import { gridGeometry, parseColumnSpecs, parseTableHeight, resolveColumns, sortRows }
  from "@/lib/story-ui/data-table";
import type { AfDataTable } from "./data-table";
import { syncRowCells } from "./data-table-cells";
import type { TableState } from "./data-table-frame";
import {
  invalidateMeasurements, measureGridColumns, observeRowHeight, renderGridFooter,
} from "./data-table-measure";
import {
  DATA_TABLE_CLASSES, measuredTableWindow, nextTableSort, TABLE_ROW_HEIGHT, tableIdentity,
  tableRowIdentities, type TableData,
} from "./table-model";
function cycleTableSort(el: AfDataTable, s: TableState, column: string) {
  s.order = nextTableSort(el.sort, column);
  if (s.viewport) s.viewport.scrollTop = 0;
  el.dispatchEvent(new CustomEvent("af-sort-change", { detail: el.sort, bubbles: true }));
  if (el.source) {
    s.loader.cancel();
    ++s.requestEpoch;
    s.pending = false;
    void el.loadMore(true);
  } else s.render();
}
export function renderGrid(
  el: AfDataTable,
  s: TableState,
  table: HTMLTableElement,
  head: HTMLTableRowElement,
  body: HTMLTableSectionElement,
  focused: HTMLElement | null,
) {
  const document = el.ownerDocument;
  let keys: string[];
  try {
    keys = tableRowIdentities(el.data.rows, el.rowKey);
  } catch (e) {
    body.replaceChildren();
    const td = body.insertRow().insertCell();
    td.className = DATA_TABLE_CLASSES.cell;
    td.setAttribute("role", "alert");
    td.textContent = (e as Error).message;
    return;
  }
  const currentKeys = new Set(keys);
  for (const key of s.rowHeights.keys()) if (!currentKeys.has(key)) s.rowHeights.delete(key);
  if (!el.data.rows.length) s.viewport!.scrollTop = 0;
  const columns = resolveColumns(parseColumnSpecs(el.columns), el.data.columns, el.data.rows);
  // A column set or width change drops back to natural layout so widths are remeasured.
  const signature = columns.map((column) => `${column.col}:${column.width ?? ""}`)
    .join("\u0000");
  if (signature !== s.columnSignature) {
    s.columnSignature = signature;
    s.measuredHeaderWidths = null;
    invalidateMeasurements(s);
    s.virtualized = false;
  }
  table.style.display = s.virtualized ? "block" : "";
  table.tHead!.style.display = s.virtualized ? "block" : "";
  const wanted = new Set(columns.map((c) => c.col));
  for (const [key, th] of s.heads)
    if (!wanted.has(key)) {
      th.remove();
      s.heads.delete(key);
    }
  for (const column of columns) {
    let th = s.heads.get(column.col);
    if (!th) {
      th = document.createElement("th");
      th.className = DATA_TABLE_CLASSES.header;
      th.scope = "col";
      th.onclick = () => cycleTableSort(el, s, column.col);
      th.tabIndex = 0;
      th.onkeydown = (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          cycleTableSort(el, s, column.col);
        }
      };
      s.heads.set(column.col, th);
    }
    th.className = DATA_TABLE_CLASSES.header;
    const identity = el.columnIdentities[column.col];
    if (identity) th.setAttribute("data-af-id", identity.afId);
    else th.removeAttribute("data-af-id");
    if (identity?.id) th.id = identity.id;
    else th.removeAttribute("id");
    th.textContent = column.title;
    if (el.sort?.col === column.col) {
      const indicator = document.createElement("span");
      indicator.setAttribute("aria-hidden", "true");
      indicator.textContent = el.sort.dir === "asc" ? " ▲" : " ▼";
      th.append(indicator);
    }
    th.setAttribute("aria-label", `Sort by ${column.title}`);
    th.setAttribute(
      "aria-sort",
      el.sort?.col === column.col ? (el.sort.dir === "asc" ? "ascending" : "descending") : "none",
    );
    th.style.textAlign = column.align;
    if (head.cells[columns.indexOf(column)] !== th)
      head.insertBefore(th, head.cells[columns.indexOf(column)] ?? null);
  }
  const geometry = gridGeometry(columns, s.measuredHeaderWidths);
  head.style.display = s.virtualized ? "grid" : "";
  head.style.gridTemplateColumns = s.virtualized ? geometry.template : "";
  head.style.width = s.virtualized ? "100%" : "";
  head.style.minWidth = s.virtualized && geometry.minWidth ? `${geometry.minWidth}px` : "";
  // Map row objects to their keys (queue per object, so a repeated object keeps each of its
  // keys in order) so sorting by value still yields each row's stable identity.
  const byRow = new Map<TableData["rows"][number], string[]>();
  el.data.rows.forEach((row, index) => {
    const queue = byRow.get(row) ?? [];
    queue.push(keys[index]!);
    byRow.set(row, queue);
  });
  // A server source already returns rows in the requested order.
  const ordered = el.source ? el.data.rows : sortRows(el.data.rows, el.sort);
  const orderedKeys = ordered.map((row) => byRow.get(row)!.shift()!);
  // Rows not yet measured use the 33px estimate; the first pass renders up to 50 rows
  // unvirtualized so the browser can size columns naturally.
  const window = s.virtualized
    ? measuredTableWindow(
      orderedKeys.map((key) => s.rowHeights.get(key) ?? TABLE_ROW_HEIGHT),
      s.viewport!.scrollTop,
      s.viewport!.clientHeight || parseTableHeight(el.height),
    )
    : { start: 0, end: Math.min(50, ordered.length), total: 0, offsets: [] as number[] };
  body.style.display = s.virtualized ? "block" : "";
  body.style.height = s.virtualized ? `${window.total}px` : "";
  body.style.position = s.virtualized ? "relative" : "";
  body.style.width = s.virtualized ? "100%" : "";
  const active = new Set<string>();
  const desired: Node[] = [];
  for (let i = window.start; i < window.end; i++) {
    const row = ordered[i]!, key = orderedKeys[i]!;
    active.add(key);
    let tr = s.rows.get(key);
    if (!tr) {
      tr = document.createElement("tr");
      tr.dataset.rowKey = key;
      tr.setAttribute("data-af-id", tableIdentity(s, el.getAttribute("data-af-id"), `row:${key}`));
      s.rows.set(key, tr);
    }
    tr.setAttribute("aria-rowindex", String(i + 2));
    tr.style.display = s.virtualized ? "grid" : "";
    tr.style.gridTemplateColumns = s.virtualized ? geometry.template : "";
    tr.style.width = s.virtualized ? "100%" : "";
    tr.style.minWidth = s.virtualized && geometry.minWidth ? `${geometry.minWidth}px` : "";
    tr.style.position = s.virtualized ? "absolute" : "";
    tr.style.top = s.virtualized ? "0px" : "";
    tr.style.left = s.virtualized ? "0px" : "";
    tr.style.transform = s.virtualized ? `translateY(${window.offsets[i]}px)` : "";
    observeRowHeight(s, tr);
    syncRowCells(el, s, tr, row, key, i, columns, wanted);
    desired.push(tr);
  }
  // Preserve nodes and focused controls by moving only rows whose order changed.
  let cursor = body.firstChild;
  for (const node of desired) {
    if (node === cursor) cursor = cursor.nextSibling;
    else body.insertBefore(node, cursor);
  }
  while (cursor) {
    const next = cursor.nextSibling;
    cursor.remove();
    cursor = next;
  }
  for (const [key, row] of s.rows)
    if (!active.has(key)) {
      s.rowObserver?.unobserve(row);
      s.rows.delete(key);
    }
  if (focused?.isConnected && el.ownerDocument.activeElement !== focused)
    focused.focus({ preventScroll: true });
  if (!ordered.length) {
    const td = body.insertRow().insertCell();
    td.className = DATA_TABLE_CLASSES.cell;
    td.colSpan = Math.max(1, columns.length);
    td.textContent = s.pending ? "loading rows…" : "no rows";
  }
  // Measuring re-renders; stop here so the footer is only built by that nested pass.
  if (measureGridColumns(el, s, table, head, body, columns)) return;
  table.setAttribute("aria-colcount", String(columns.length));
  table.setAttribute("aria-rowcount", String((el.data.totalRows ?? ordered.length) + 1));
  renderGridFooter(el, s);
}

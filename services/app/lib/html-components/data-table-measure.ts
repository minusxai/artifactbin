/**
 * Internal: af-data-table grid measurement (row heights, natural column widths, the switch to
 *   virtualized layout) and the row-count/load-more footer.
 * Used by: data-table.ts, data-table-grid.ts.
 */
import type { AfDataTable } from "./data-table";
import type { TableState } from "./data-table-frame";
export function invalidateMeasurements(s: TableState, retainRowEstimates = false) {
  if (!retainRowEstimates) s.rowHeights.clear();
  // Observers do not redeliver unchanged retained nodes after a cache reset.
  // Reobserve them during render so every rendered row obtains a fresh size.
  s.rowObserver?.disconnect();
}
/** Observes a virtualized row; measured heights feed the window, and the table re-renders
 * only when some height actually changed. */
export function observeRowHeight(s: TableState, tr: HTMLTableRowElement) {
  if (s.virtualized && !s.rowObserver && typeof ResizeObserver !== "undefined") {
    s.rowObserver = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        const row = entry.target as HTMLTableRowElement;
        const key = row.dataset.rowKey;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (row.isConnected && key && height > 0 && s.rowHeights.get(key) !== height) {
          s.rowHeights.set(key, height);
          changed = true;
        }
      }
      if (changed) s.render();
    });
  }
  if (s.virtualized) s.rowObserver?.observe(tr);
}
/** Records header widths and schedules the first virtualized pass. Returns true when it
 * re-rendered (after remeasuring columns), so the caller must stop. */
export function measureGridColumns(
  el: AfDataTable, s: TableState, table: HTMLTableElement, head: HTMLTableRowElement,
  body: HTMLTableSectionElement, columns: readonly unknown[],
): boolean {
  if (s.virtualized && s.columnsNeedMeasurement) {
    // Measure the retained window in natural table layout. A spacer preserves the
    // scroll extent while positioning the same live nodes outside normal flow;
    // no focused control or renderer is cloned, removed, or recreated.
    const viewport = s.viewport!, scrollTop = viewport.scrollTop;
    const spacer = el.ownerDocument.createElement("div");
    spacer.style.height = `${viewport.scrollHeight}px`;
    spacer.setAttribute("aria-hidden", "true");
    const elements: HTMLElement[] =
      [viewport, table, table.tHead!, head, body, ...Array.from(body.rows)];
    const styles = elements.map(element => element.style.cssText);
    viewport.append(spacer);
    try {
      viewport.style.position = "relative";
      table.style.cssText += ";display:table;position:absolute;top:0;left:0;width:100%";
      table.tHead!.style.display = "table-header-group";
      head.style.cssText = "display:table-row";
      body.style.cssText = "display:table-row-group";
      for (const row of Array.from(body.rows)) row.style.cssText = "display:table-row";
      const widths =
        columns.map((_, index) => head.cells[index]?.getBoundingClientRect().width ?? 0);
      if (widths.some(width => width > 0)) s.measuredHeaderWidths = widths;
    } finally {
      elements.forEach((element, index) => { element.style.cssText = styles[index]!; });
      spacer.remove();
      viewport.scrollTop = scrollTop;
    }
    s.columnsNeedMeasurement = false;
    s.render();
    return true;
  }
  if (!s.virtualized) {
    const widths =
      columns.map((_, index) => head.cells[index]?.getBoundingClientRect().width ?? 0);
    if (widths.some((width) => width > 0)) s.measuredHeaderWidths = widths;
    s.columnsNeedMeasurement = false;
  }
  // The first render lays out naturally; virtualization starts one microtask later, once the
  // browser has sized the columns.
  if (!s.virtualized && !s.virtualizationPending) {
    s.virtualizationPending = true;
    queueMicrotask(() => {
      s.virtualizationPending = false;
      if (el.isConnected) {
        s.virtualized = true;
        s.render();
      }
    });
  }
  return false;
}
export function renderGridFooter(el: AfDataTable, s: TableState) {
  const document = el.ownerDocument;
  const more = el.data.truncated || (el.data.totalRows ?? 0) > el.data.rows.length;
  if (s.pending) s.footer!.append("loading rows…");
  else if (s.showRowCount || more) {
    const count = document.createElement("span");
    count.setAttribute("aria-label", "Row count");
    count.dataset.slot = "row-count";
    count.style.lineHeight = "1rem";
    const format = new Intl.NumberFormat();
    count.textContent = `${format.format(el.data.rows.length)} of ${format.format(
      el.data.totalRows ?? el.data.rows.length)} rows`;
    s.footer!.append(count);
  }
  if (el.source && !s.pending && more) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "load more";
    button.setAttribute("aria-label", "Load more rows");
    button.style.cssText =
      "font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0;" +
      "text-underline-offset:2px";
    button.style.setProperty("font-weight", "500", "important");
    button.onmouseenter = () => (button.style.textDecoration = "underline");
    button.onmouseleave = () => (button.style.textDecoration = "");
    button.onclick = () => void el.loadMore();
    s.footer!.append(button);
  }
}

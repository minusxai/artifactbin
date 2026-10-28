/**
 * Internal: transposed af-data-table layout (one row per metric, one column per item) built
 *   from compareTable; rows are keyed by metric column so they survive re-renders.
 * Used by: data-table-frame.ts.
 */
import { compareTable, parseMetricSpecs } from "@/lib/story-ui/compare";
import type { AfDataTable } from "./data-table";
import type { TableState } from "./data-table-frame";
import { DATA_TABLE_CLASSES, tableIdentity } from "./table-model";
export function renderComparison(
  el: AfDataTable,
  s: TableState,
  table: HTMLTableElement,
  head: HTMLTableRowElement,
  body: HTMLTableSectionElement,
) {
  const document = el.ownerDocument;
  const identity = (key: string) => tableIdentity(s, el.getAttribute("data-af-id"), key);
  // Undo the virtualized grid's inline layout in case the table was a grid before.
  table.style.display = "";
  table.tHead!.style.display = "";
  table.tHead!.rows[0]!.style.display = "";
  table.tHead!.rows[0]!.style.gridTemplateColumns = "";
  body.style.display = "";
  body.style.height = "";
  body.style.position = "";
  for (const row of s.comparisonRows.values()) {
    row.style.display = "";
    row.style.gridTemplateColumns = "";
    row.style.position = "";
    row.style.transform = "";
  }
  const model = compareTable({
    ...el.data,
    header: el.header,
    metrics: el.metrics === undefined ? null : parseMetricSpecs(el.metrics),
    edge: el.edge,
  });
  const headerTitles = ["Measure", ...model.items, ...(el.edge ? ["Edge"] : [])];
  while (head.cells.length > headerTitles.length) head.deleteCell(-1);
  headerTitles.forEach((title, index) => {
    let th = head.cells[index];
    if (!th || th.tagName !== "TH") {
      th = document.createElement("th");
      head.append(th);
    }
    th.className = DATA_TABLE_CLASSES.header;
    th.scope = "col";
    th.textContent = title;
  });
  const retained = new Set<string>();
  for (const metric of model.rows) {
    retained.add(metric.col);
    let tr = s.comparisonRows.get(metric.col);
    if (!tr) {
      tr = document.createElement("tr");
      tr.setAttribute("data-af-id", identity(`comparison-row:${metric.col}`));
      s.comparisonRows.set(metric.col, tr);
    }
    let th = tr.cells[0];
    if (!th) {
      th = document.createElement("th");
      th.className = DATA_TABLE_CLASSES.header;
      th.scope = "row";
      tr.append(th);
    }
    th.className = DATA_TABLE_CLASSES.header;
    th.textContent = metric.title;
    metric.cells.forEach((cell, index) => {
      let td = tr!.cells[index + 1];
      if (!td) {
        td = document.createElement("td");
        td.className = DATA_TABLE_CLASSES.cell;
        tr!.append(td);
      }
      td.className = DATA_TABLE_CLASSES.cell;
      td.setAttribute("data-af-id", identity(`comparison-cell:${metric.col}:${index}`));
      td.replaceChildren();
      const strong = document.createElement(cell.best ? "strong" : "span");
      strong.textContent = cell.text;
      td.append(strong);
      if (cell.rank) td.append(` ${cell.rank}`);
      if (cell.sub) {
        const sub = document.createElement("small");
        sub.textContent = cell.sub;
        td.append(sub);
      }
    });
    const length = metric.cells.length + 1 + (el.edge ? 1 : 0);
    while (tr.cells.length > length) tr.deleteCell(-1);
    if (el.edge) {
      let cell = tr.cells[length - 1];
      if (!cell) cell = tr.insertCell();
      cell.className = DATA_TABLE_CLASSES.cell;
      cell.textContent = metric.edge ? metric.edge.lead + metric.edge.rest : "";
    }
    body.append(tr);
  }
  for (const [key, row] of s.comparisonRows)
    if (!retained.has(key)) {
      row.remove();
      s.comparisonRows.delete(key);
    }
  for (const row of Array.from(body.rows))
    if (!Array.from(s.comparisonRows.values()).includes(row)) row.remove();
  if (!model.items.length) {
    const td = body.insertRow().insertCell();
    td.className = DATA_TABLE_CLASSES.cell;
    td.colSpan = Math.max(1, headerTitles.length);
    td.textContent = "no rows";
  }
  table.setAttribute("aria-rowcount", String(model.rows.length + 1));
  table.setAttribute("aria-colcount", String(headerTitles.length));
  if (model.total > model.items.length)
    s.footer!.append(`showing ${model.items.length} of ${model.total} items`);
}

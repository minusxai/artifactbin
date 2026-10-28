/**
 * Internal: af-data-table cell content for one keyed row: custom renderer, cloned <template>
 *   (ids scoped per cell) or formatted text with bar/image/time decorations.
 * Used by: data-table-grid.ts.
 */
import { barFraction, cellTint, formatCell, resolveColumns } from "@/lib/story-ui/data-table";
import type { AfDataTable } from "./data-table";
import type { TableState } from "./data-table-frame";
import { DATA_TABLE_CLASSES, tableIdentity, type TableData } from "./table-model";
type Column = ReturnType<typeof resolveColumns>[number];
type Row = TableData["rows"][number];
const ID_REFERENCES = ["for", "aria-labelledby", "aria-describedby", "aria-controls", "headers"];
/** Clones a template into a cell. Template ids get a per-cell prefix (and id references are
 * rewritten) so repeated rows never duplicate ids; authored data-af-id values become stable
 * generated ids keyed by row, column and the authored value. */
function cloneTemplate(
  s: TableState, hostId: string | null, template: HTMLTemplateElement,
  scope: string, key: string, col: string,
): DocumentFragment {
  const clone = template.content.cloneNode(true) as DocumentFragment;
  const ids = new Map<string, string>();
  for (const node of clone.querySelectorAll<HTMLElement>("[id]")) {
    const id = node.id;
    const scoped = `${scope}-${encodeURIComponent(id)}`;
    ids.set(id, scoped);
    node.id = scoped;
  }
  for (const node of clone.querySelectorAll<HTMLElement>("*")) {
    const authored = node.getAttribute("data-af-id");
    if (authored)
      node.setAttribute(
        "data-af-id",
        tableIdentity(s, hostId, JSON.stringify(["template", key, col, authored])),
      );
    for (const attr of ID_REFERENCES) {
      const value = node.getAttribute(attr);
      if (value)
        node.setAttribute(attr, value.split(/\s+/).map((id) => ids.get(id) ?? id).join(" "));
    }
    const href = node.getAttribute("href");
    if (href?.startsWith("#") && ids.has(href.slice(1)))
      node.setAttribute("href", `#${ids.get(href.slice(1))}`);
  }
  return clone;
}
function renderText(el: AfDataTable, td: HTMLTableCellElement, row: Row, column: Column) {
  const document = el.ownerDocument;
  const text = formatCell(row[column.col], column);
  // Rebuild only when the visible text or bar changed, so unchanged cells keep their nodes.
  if (
    td.dataset.text === text &&
    td.dataset.barValue === String(barFraction(row[column.col], column))
  )
    return;
  td.replaceChildren();
  const fraction = barFraction(row[column.col], column);
  if (fraction !== null) {
    const bar = document.createElement("span");
    bar.dataset.bar = "";
    bar.setAttribute("aria-hidden", "true");
    bar.style.width = `${fraction * 100}%`;
    bar.style.background =
      typeof column.bar === "object" ? (column.bar.color ?? "var(--chart-1)") : "var(--chart-1)";
    td.append(bar);
  }
  const content = document.createElement("span");
  content.dataset.slot = "cell-content";
  content.textContent = text;
  if (column.kind === "image" && typeof row[column.col] === "string") {
    const src = el.resolveSrc?.(row[column.col] as string);
    if (src) {
      const image = document.createElement("img");
      image.src = src;
      image.alt = "";
      image.loading = "lazy";
      image.style.cssText = "max-height:2rem;width:auto;vertical-align:middle";
      content.replaceChildren(image);
    }
  } else if (column.type === "timestamp" && typeof row[column.col] === "string") {
    const time = document.createElement("time");
    time.dateTime = row[column.col] as string;
    time.textContent = text;
    content.replaceChildren(time);
  }
  td.append(content);
  td.dataset.text = text;
  td.dataset.barValue = String(fraction);
}
export function syncRowCells(
  el: AfDataTable, s: TableState, tr: HTMLTableRowElement, row: Row, key: string,
  i: number, columns: Column[], wanted: Set<string>,
) {
  const document = el.ownerDocument;
  const hostId = () => el.getAttribute("data-af-id");
  for (const column of columns) {
    let td = Array.from(tr.cells).find((c) => c.dataset.column === column.col);
    if (!td) {
      td = document.createElement("td");
      td.className = DATA_TABLE_CLASSES.cell;
      td.dataset.column = column.col;
      td.setAttribute("data-af-id", tableIdentity(s, hostId(), `cell:${key}:${column.col}`));
      if (tr.cells[columns.indexOf(column)] !== td)
        tr.insertBefore(td, tr.cells[columns.indexOf(column)] ?? null);
    }
    td.className = DATA_TABLE_CLASSES.cell;
    td.style.textAlign = column.align;
    td.style.fontVariantNumeric = column.type === "number" ? "tabular-nums" : "";
    td.style.width = column.width ? `${column.width}px` : "";
    td.style.background = cellTint(row[column.col], column) ?? "";
    const context = {
      row,
      key: el.rowKey ? row[el.rowKey] : undefined,
      column: column.col,
      index: i,
      identity: td.getAttribute("data-af-id")!,
      edit: (value: unknown) =>
        el.dispatchEvent(new CustomEvent("af-edit-intent", {
          detail: { row, key: el.rowKey ? row[el.rowKey] : undefined, column: column.col, value },
          bubbles: true,
          composed: true,
        })),
    };
    const renderer = el.cellRenderers[column.col];
    const template = el.templates.find((t) => t.col === column.col);
    // Switching renderer/template/text clears the cell; same mode updates it in place.
    const mode = renderer ?? template?.template ?? "text";
    if (s.cellModes.get(td) !== mode) {
      td.replaceChildren();
      delete td.dataset.text;
      s.cellModes.set(td, mode);
    }
    if (renderer) {
      const result = renderer(context, td);
      if (result !== undefined && result !== td.firstChild) td.replaceChildren(result);
    } else if (template) {
      if (!td.firstChild)
        td.append(cloneTemplate(s, hostId(), template.template, context.identity, key, column.col));
      for (const field of td.querySelectorAll<HTMLElement>("[data-field]"))
        field.textContent = String(row[field.dataset.field!] ?? "");
    } else renderText(el, td, row, column);
    if (tr.cells[columns.indexOf(column)] !== td)
      tr.insertBefore(td, tr.cells[columns.indexOf(column)] ?? null);
  }
  for (const td of Array.from(tr.cells)) if (!wanted.has(td.dataset.column!)) td.remove();
}

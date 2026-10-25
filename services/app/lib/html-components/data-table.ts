import {
  barFraction,
  cellTint,
  formatCell,
  parseColumnSpecs,
  parseSortSpec,
  parseTableHeight,
  resolveColumns,
  sortRows,
  gridGeometry,
  type SortSpec,
} from "@/lib/story-ui/data-table";
import { compareTable, parseMetricSpecs } from "@/lib/story-ui/compare";
import {
  nextTableSort,
  TABLE_ROW_HEIGHT,
  tableRowIdentities,
  measuredTableWindow,
  TableLoader,
  type TableData,
  type TableSource,
  type TableCellRenderer,
  type TableTemplate,
} from "./table-model";
const DATA_TABLE_CLASSES = {
  table: "af-data-table__table",
  header: "af-data-table__header-cell",
  cell: "af-data-table__cell",
} as const;
export interface TableColumnIdentity {
  afId: string;
  id?: string;
}
interface DataTableContract {
  /** Replacing data retains keyed DOM, but invalidates and remeasures its geometry
   * even when the observed rows have not resized. Column measurement waits for a connected
   * table and repeats when its data changes. Header line height follows its font scale. */
  data: TableData;
  columns: unknown;
  columnIdentities: Readonly<Record<string, TableColumnIdentity>>;
  sort: SortSpec | null;
  transpose: boolean;
  header?: string;
  metrics: unknown;
  edge: boolean;
  height: number | string;
  sticky: boolean;
  rowKey?: string;
  resolveSrc?: (url: string) => string | null;
  source?: TableSource;
  cellRenderers: Record<string, TableCellRenderer>;
  templates: TableTemplate[];
}
let tableSequence = 0;
const empty = (): TableData => ({ rows: [], columns: [] });
export class AfDataTable extends HTMLElement implements DataTableContract {
  /** Custom renderers receive a stable identity and own drafts/capabilities. A returned
   * Node replaces the content; returning void updates the existing cell in place.
   * Offscreen rows are unmounted, so durable editing sessions belong to the caller. */
  static observedAttributes = [
    "label",
    "height",
    "sticky",
    "transpose",
    "header",
    "edge",
    "row-key",
    "columns",
    "sort",
    "metrics",
  ];
  private value = empty();
  private specs: unknown = null;
  private headerIdentities: Readonly<Record<string, TableColumnIdentity>> = {};
  private order: SortSpec | null = null;
  private renderers: Record<string, TableCellRenderer> = {};
  private templateList: TableTemplate[] = [];
  resolveSrc?: (url: string) => string | null;
  private loader = new TableLoader();
  private transport?: TableSource;
  private showRowCount = false;
  private pending = false;
  private requestEpoch = 0;
  private instancePrefix = `af-table-${++tableSequence}`;
  private error = "";
  private table?: HTMLTableElement;
  private viewport?: HTMLDivElement;
  private viewportObserver?: ResizeObserver;
  private rowObserver?: ResizeObserver;
  private rowHeights = new Map<string, number>();
  private measuredHeaderWidths: number[] | null = null;
  private columnSignature = "";
  private virtualized = false;
  private columnsNeedMeasurement = false;
  private virtualizationPending = false;
  private footer?: HTMLDivElement;
  private rows = new Map<string, HTMLTableRowElement>();
  private comparisonRows = new Map<string, HTMLTableRowElement>();
  private heads = new Map<string, HTMLTableCellElement>();
  private ids = new Map<string, string>();
  private serial = 0;
  private cellModes = new WeakMap<HTMLElement, unknown>();
  private invalidateMeasurements() {
    this.rowHeights.clear();
    // Observers do not redeliver unchanged retained nodes after a cache reset.
    // Reobserve them during render so every rendered row obtains a fresh size.
    this.rowObserver?.disconnect();
  }
  get data() {
    return this.value;
  }
  set data(v: TableData) {
    this.loader.cancel();
    ++this.requestEpoch;
    if (this.viewport && (v?.rows.length ?? 0) < this.value.rows.length)
      this.viewport.scrollTop = 0;
    this.value = v ?? empty();
    this.invalidateMeasurements();
    this.columnsNeedMeasurement = true;
    this.showRowCount = Boolean(
      this.value.truncated ||
        (this.value.totalRows ?? 0) > this.value.rows.length,
    );
    this.error = "";
    this.pending = false;
    this.render();
  }
  get columns() {
    return this.specs;
  }
  set columns(v: unknown) {
    this.specs = v;
    this.render();
  }
  get columnIdentities() {
    return this.headerIdentities;
  }
  set columnIdentities(value: Readonly<Record<string, TableColumnIdentity>>) {
    const ids = new Set<string>(), afIds = new Set<string>();
    const valid = (id: unknown): id is string => typeof id === "string" && !!id && id.length <= 4096 && !/[\s\u0000-\u001f]/.test(id);
    const next: Record<string, TableColumnIdentity> = Object.create(null);
    for (const [column, identity] of Object.entries(value)) {
      if (!column || !identity || !valid(identity.afId) || afIds.has(identity.afId) || identity.id !== undefined && (!valid(identity.id) || ids.has(identity.id))) throw Error("Invalid column identity");
      afIds.add(identity.afId);
      if (identity.id !== undefined) ids.add(identity.id);
      next[column] = Object.freeze({ ...identity });
    }
    this.headerIdentities = Object.freeze(next);
    this.render();
  }
  get sort() {
    return this.order;
  }
  set sort(v: SortSpec | null) {
    this.order = parseSortSpec(v);
    if (this.viewport) this.viewport.scrollTop = 0;
    if (this.source && this.isConnected) {
      this.loader.cancel();
      ++this.requestEpoch;
      this.pending = false;
      void this.loadMore(true);
    } else this.render();
  }
  get source() {
    return this.transport;
  }
  set source(v: TableSource | undefined) {
    this.loader.cancel();
    ++this.requestEpoch;
    this.transport = v;
    this.showRowCount = false;
    this.pending = false;
    this.error = "";
    if (v) {
      this.value = empty();
      if (this.viewport) this.viewport.scrollTop = 0;
    }
    if (v && this.isConnected) void this.loadMore(true);
    else this.render();
  }
  get cellRenderers() {
    return this.renderers;
  }
  set cellRenderers(v: Record<string, TableCellRenderer>) {
    this.renderers = v;
    this.render();
  }
  get templates() {
    return this.templateList;
  }
  set templates(v: TableTemplate[]) {
    this.templateList = v;
    this.render();
  }
  get transpose() {
    return this.hasAttribute("transpose");
  }
  set transpose(v: boolean) {
    this.toggleAttribute("transpose", v);
  }
  get edge() {
    return this.hasAttribute("edge");
  }
  set edge(v: boolean) {
    this.toggleAttribute("edge", v);
  }
  get sticky() {
    return this.getAttribute("sticky") !== "false";
  }
  set sticky(v: boolean) {
    this.setAttribute("sticky", String(v));
  }
  get height() {
    return this.getAttribute("height") ?? 420;
  }
  set height(v: number | string) {
    this.setAttribute("height", String(v));
  }
  get header() {
    return this.getAttribute("header") ?? undefined;
  }
  set header(v: string | undefined) {
    if (v === undefined) this.removeAttribute("header");
    else this.setAttribute("header", v);
  }
  get rowKey() {
    return this.getAttribute("row-key") ?? undefined;
  }
  set rowKey(v: string | undefined) {
    if (v === undefined) this.removeAttribute("row-key");
    else this.setAttribute("row-key", v);
  }
  private metricSpecs: unknown;
  get metrics() {
    return this.metricSpecs;
  }
  set metrics(v: unknown) {
    this.metricSpecs = v;
    this.render();
  }
  connectedCallback() {
    for (const key of [
      "data",
      "columns",
      "columnIdentities",
      "sort",
      "source",
      "cellRenderers",
      "templates",
      "metrics",
      "rowKey",
      "height",
      "sticky",
      "transpose",
      "header",
      "edge",
    ] as const) {
      if (Object.hasOwn(this, key)) {
        const v = this[key];
        delete (this as unknown as Record<string, unknown>)[key];
        (this as unknown as Record<string, unknown>)[key] = v;
      }
    }
    if (this.source && !this.pending && !this.data.rows.length)
      void this.loadMore(true);
    else this.render();
  }
  disconnectedCallback() {
    this.loader.cancel();
    ++this.requestEpoch;
    this.pending = false;
    this.viewportObserver?.disconnect();
    this.viewportObserver = undefined;
    this.rowObserver?.disconnect();
    this.rowObserver = undefined;
  }
  attributeChangedCallback(
    name: string,
    _old: string | null,
    value: string | null,
  ) {
    if (["columns", "sort", "metrics"].includes(name)) {
      let v: unknown;
      try {
        v = JSON.parse(value ?? "null");
      } catch {
        v = value;
      }
      if (name === "columns") this.specs = v;
      else if (name === "sort") {
        this.sort = parseSortSpec(v);
        return;
      } else this.metricSpecs = v;
    }
    this.render();
  }
  async loadMore(replace = false): Promise<void> {
    if (!this.source || this.pending) return;
    if (
      !replace &&
      !this.data.truncated &&
      (this.data.totalRows ?? 0) <= this.data.rows.length
    )
      return;
    const epoch = ++this.requestEpoch;
    this.pending = true;
    this.error = "";
    this.render();
    try {
      const result = await this.loader.read(this.source, {
        offset: replace ? 0 : this.data.rows.length,
        limit: 500,
        sort: this.sort,
      });
      if (!result) return;
      const rows = replace ? result.rows : [...this.data.rows, ...result.rows];
      this.showRowCount = Boolean(
        this.showRowCount || result.truncated || (result.totalRows ?? 0) > rows.length,
      );
      this.value = {
        ...result,
        rows,
      };
    } catch (e) {
      if (epoch === this.requestEpoch)
        this.error = e instanceof Error ? e.message : "Unable to load rows";
    } finally {
      if (epoch === this.requestEpoch) {
        this.pending = false;
        this.render();
      }
    }
  }
  private identity(key: string) {
    let id = this.ids.get(key);
    if (!id) {
      id = `${this.getAttribute("data-af-id") ?? this.instancePrefix}-generated-${++this.serial}`;
      this.ids.set(key, id);
    }
    return id;
  }
  private cycleSort(column: string) {
    this.order = nextTableSort(this.sort, column);
    if (this.viewport) this.viewport.scrollTop = 0;
    this.dispatchEvent(
      new CustomEvent("af-sort-change", {
        detail: this.sort,
        bubbles: true,
      }),
    );
    if (this.source) {
      this.loader.cancel();
      ++this.requestEpoch;
      this.pending = false;
      void this.loadMore(true);
    } else this.render();
  }
  private render() {
    if (!this.isConnected) return;
    const document = this.ownerDocument;
    const focused = this.contains(this.ownerDocument.activeElement)
      ? (this.ownerDocument.activeElement as HTMLElement)
      : null;
    if (!this.table) {
      this.dataset.slot = "data-table";
      this.viewport = document.createElement("div");
      this.viewport.dataset.slot = "table-scroll";
      this.table = document.createElement("table");
      this.table.className = DATA_TABLE_CLASSES.table;
      this.table.setAttribute("data-mx-kit-table", "");
      this.table.createTHead().insertRow();
      this.table.createTBody();
      this.viewport.append(this.table);
      this.footer = document.createElement("div");
      this.footer.dataset.slot = "table-footer";
      this.footer.setAttribute("aria-live", "polite");
      this.append(this.viewport, this.footer);
      this.viewport.addEventListener("scroll", () => {
        this.render();
        const viewport = this.viewport!;
        if (
          !this.transpose &&
          this.source &&
          !this.pending &&
          (this.data.truncated ||
            (this.data.totalRows ?? 0) > this.data.rows.length) &&
          viewport.clientHeight > 0 &&
          viewport.scrollTop + viewport.clientHeight >=
            viewport.scrollHeight - 216
        )
          void this.loadMore();
      });
    }
    if (!this.viewportObserver && typeof ResizeObserver !== "undefined") {
      this.viewportObserver = new ResizeObserver(() => this.render());
      this.viewportObserver.observe(this.viewport!);
    }
    const table = this.table,
      body = table.tBodies[0]!,
      head = table.tHead!.rows[0]!;
    table.setAttribute(
      "aria-label",
      this.getAttribute("label") ??
        (this.transpose ? "Comparison table" : "Data grid"),
    );
    table.setAttribute("aria-busy", String(this.pending));
    this.viewport!.style.maxHeight = `${parseTableHeight(this.height)}px`;
    table.tHead!.style.position = this.sticky ? "sticky" : "";
    table.tHead!.style.top = "0";
    this.footer!.replaceChildren();
    if (this.error) {
      const alert = document.createElement("span");
      alert.setAttribute("role", "alert");
      alert.textContent = this.error;
      this.footer!.append(alert);
    }
    const layout = this.transpose ? "comparison" : "grid";
    if (table.dataset.layout && table.dataset.layout !== layout) {
      head.replaceChildren();
      body.replaceChildren();
      this.viewport!.scrollTop = 0;
    }
    table.dataset.layout = layout;
    if (this.transpose) {
      table.style.display = "";
      table.tHead!.style.display = "";
      table.tHead!.rows[0]!.style.display = "";
      table.tHead!.rows[0]!.style.gridTemplateColumns = "";
      body.style.display = "";
      body.style.height = "";
      body.style.position = "";
      for (const row of this.comparisonRows.values()) {
        row.style.display = "";
        row.style.gridTemplateColumns = "";
        row.style.position = "";
        row.style.transform = "";
      }
      const model = compareTable({
        ...this.data,
        header: this.header,
        metrics:
          this.metrics === undefined ? null : parseMetricSpecs(this.metrics),
        edge: this.edge,
      });
      const headerTitles = [
        "Measure",
        ...model.items,
        ...(this.edge ? ["Edge"] : []),
      ];
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
        let tr = this.comparisonRows.get(metric.col);
        if (!tr) {
          tr = document.createElement("tr");
          tr.setAttribute(
            "data-af-id",
            this.identity(`comparison-row:${metric.col}`),
          );
          this.comparisonRows.set(metric.col, tr);
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
          td.setAttribute(
            "data-af-id",
            this.identity(`comparison-cell:${metric.col}:${index}`),
          );
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
        const length = metric.cells.length + 1 + (this.edge ? 1 : 0);
        while (tr.cells.length > length) tr.deleteCell(-1);
        if (this.edge) {
          let cell = tr.cells[length - 1];
          if (!cell) cell = tr.insertCell();
          cell.className = DATA_TABLE_CLASSES.cell;
          cell.textContent = metric.edge
            ? metric.edge.lead + metric.edge.rest
            : "";
        }
        body.append(tr);
      }
      for (const [key, row] of this.comparisonRows)
        if (!retained.has(key)) {
          row.remove();
          this.comparisonRows.delete(key);
        }
      for (const row of Array.from(body.rows))
        if (!Array.from(this.comparisonRows.values()).includes(row))
          row.remove();
      if (!model.items.length) {
        const td = body.insertRow().insertCell();
        td.className = DATA_TABLE_CLASSES.cell;
        td.colSpan = Math.max(1, headerTitles.length);
        td.textContent = "no rows";
      }
      table.setAttribute("aria-rowcount", String(model.rows.length + 1));
      table.setAttribute("aria-colcount", String(headerTitles.length));
      if (model.total > model.items.length)
        this.footer!.append(
          `showing ${model.items.length} of ${model.total} items`,
        );
      return;
    }
    let keys: string[];
    try {
      keys = tableRowIdentities(this.data.rows, this.rowKey);
    } catch (e) {
      body.replaceChildren();
      const td = body.insertRow().insertCell();
      td.className = DATA_TABLE_CLASSES.cell;
      td.setAttribute("role", "alert");
      td.textContent = (e as Error).message;
      return;
    }
    if (!this.data.rows.length) this.viewport!.scrollTop = 0;
    const columns = resolveColumns(
      parseColumnSpecs(this.columns),
      this.data.columns,
      this.data.rows,
    );
    const signature = columns.map((column) => `${column.col}:${column.width ?? ""}`).join("\u0000");
    if (signature !== this.columnSignature) {
      this.columnSignature = signature;
      this.measuredHeaderWidths = null;
      this.invalidateMeasurements();
      this.virtualized = false;
    }
    table.style.display = this.virtualized ? "block" : "";
    table.tHead!.style.display = this.virtualized ? "block" : "";
    const wanted = new Set(columns.map((c) => c.col));
    for (const [key, th] of this.heads)
      if (!wanted.has(key)) {
        th.remove();
        this.heads.delete(key);
      }
    for (const column of columns) {
      let th = this.heads.get(column.col);
      if (!th) {
        th = document.createElement("th");
        th.className = DATA_TABLE_CLASSES.header;
        th.scope = "col";
        th.onclick = () => this.cycleSort(column.col);
        th.tabIndex = 0;
        th.onkeydown = (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            this.cycleSort(column.col);
          }
        };
        this.heads.set(column.col, th);
      }
      th.className = DATA_TABLE_CLASSES.header;
      const identity = this.columnIdentities[column.col];
      if (identity) th.setAttribute("data-af-id", identity.afId);
      else th.removeAttribute("data-af-id");
      if (identity?.id) th.id = identity.id;
      else th.removeAttribute("id");
      th.textContent = column.title;
      if (this.sort?.col === column.col) {
        const indicator = document.createElement("span");
        indicator.setAttribute("aria-hidden", "true");
        indicator.textContent = this.sort.dir === "asc" ? " ▲" : " ▼";
        th.append(indicator);
      }
      th.setAttribute("aria-label", `Sort by ${column.title}`);
      th.setAttribute(
        "aria-sort",
        this.sort?.col === column.col
          ? this.sort.dir === "asc"
            ? "ascending"
            : "descending"
          : "none",
      );
      th.style.textAlign = column.align;
      if (head.cells[columns.indexOf(column)] !== th)
        head.insertBefore(th, head.cells[columns.indexOf(column)] ?? null);
    }
    const geometry = gridGeometry(columns, this.measuredHeaderWidths);
    head.style.display = this.virtualized ? "grid" : "";
    head.style.gridTemplateColumns = this.virtualized ? geometry.template : "";
    head.style.width = this.virtualized ? "100%" : "";
    head.style.minWidth = this.virtualized && geometry.minWidth ? `${geometry.minWidth}px` : "";
    const byRow = new Map<TableData["rows"][number], string[]>();
    this.data.rows.forEach((row, index) => {
      const queue = byRow.get(row) ?? [];
      queue.push(keys[index]!);
      byRow.set(row, queue);
    });
    const ordered = this.source
      ? this.data.rows
      : sortRows(this.data.rows, this.sort);
    const orderedKeys = ordered.map((row) => byRow.get(row)!.shift()!);
    const window = this.virtualized
      ? measuredTableWindow(
          orderedKeys.map((key) => this.rowHeights.get(key) ?? TABLE_ROW_HEIGHT),
          this.viewport!.scrollTop,
          this.viewport!.clientHeight || parseTableHeight(this.height),
        )
      : { start: 0, end: Math.min(50, ordered.length), total: 0, offsets: [] as number[] };
    body.style.display = this.virtualized ? "block" : "";
    body.style.height = this.virtualized ? `${window.total}px` : "";
    body.style.position = this.virtualized ? "relative" : "";
    body.style.width = this.virtualized ? "100%" : "";
    const active = new Set<string>();
    const desired: Node[] = [];
    for (let i = window.start; i < window.end; i++) {
      const row = ordered[i]!,
        key = orderedKeys[i]!;
      active.add(key);
      let tr = this.rows.get(key);
      if (!tr) {
        tr = document.createElement("tr");
        tr.dataset.rowKey = key;
        tr.setAttribute("data-af-id", this.identity(`row:${key}`));
        this.rows.set(key, tr);
      }
      tr.setAttribute("aria-rowindex", String(i + 2));
      tr.style.display = this.virtualized ? "grid" : "";
      tr.style.gridTemplateColumns = this.virtualized ? geometry.template : "";
      tr.style.width = this.virtualized ? "100%" : "";
      tr.style.minWidth = this.virtualized && geometry.minWidth ? `${geometry.minWidth}px` : "";
      tr.style.position = this.virtualized ? "absolute" : "";
      tr.style.top = this.virtualized ? "0px" : "";
      tr.style.left = this.virtualized ? "0px" : "";
      tr.style.transform = this.virtualized ? `translateY(${window.offsets[i]}px)` : "";
      if (this.virtualized && !this.rowObserver && typeof ResizeObserver !== "undefined") {
        this.rowObserver = new ResizeObserver((entries) => {
          let changed = false;
          for (const entry of entries) {
            const row = entry.target as HTMLTableRowElement;
            const key = row.dataset.rowKey;
            const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
            if (row.isConnected && key && height > 0 && this.rowHeights.get(key) !== height) {
              this.rowHeights.set(key, height);
              changed = true;
            }
          }
          if (changed) this.render();
        });
      }
      if (this.virtualized) this.rowObserver?.observe(tr);
      for (const column of columns) {
        let td = Array.from(tr.cells).find(
          (c) => c.dataset.column === column.col,
        );
        if (!td) {
          td = document.createElement("td");
          td.className = DATA_TABLE_CLASSES.cell;
          td.dataset.column = column.col;
          td.setAttribute(
            "data-af-id",
            this.identity(`cell:${key}:${column.col}`),
          );
          if (tr.cells[columns.indexOf(column)] !== td)
            tr.insertBefore(td, tr.cells[columns.indexOf(column)] ?? null);
        }
        td.className = DATA_TABLE_CLASSES.cell;
        td.style.textAlign = column.align;
        td.style.fontVariantNumeric =
          column.type === "number" ? "tabular-nums" : "";
        td.style.width = column.width ? `${column.width}px` : "";
        td.style.background = cellTint(row[column.col], column) ?? "";
        const context = {
          row,
          key: this.rowKey ? row[this.rowKey] : undefined,
          column: column.col,
          index: i,
          identity: td.getAttribute("data-af-id")!,
          edit: (value: unknown) =>
            this.dispatchEvent(
              new CustomEvent("af-edit-intent", {
                detail: {
                  row,
                  key: this.rowKey ? row[this.rowKey] : undefined,
                  column: column.col,
                  value,
                },
                bubbles: true,
                composed: true,
              }),
            ),
        };
        const renderer = this.cellRenderers[column.col];
        const template = this.templates.find((t) => t.col === column.col);
        const mode = renderer ?? template?.template ?? "text";
        if (this.cellModes.get(td) !== mode) {
          td.replaceChildren();
          delete td.dataset.text;
          this.cellModes.set(td, mode);
        }
        if (renderer) {
          const result = renderer(context, td);
          if (result !== undefined && result !== td.firstChild)
            td.replaceChildren(result);
        } else {
          if (template) {
            if (!td.firstChild) {
              const clone = template.template.content.cloneNode(
                true,
              ) as DocumentFragment;
              const ids = new Map<string, string>();
              for (const node of clone.querySelectorAll<HTMLElement>("[id]")) {
                const id = node.id;
                const scoped = `${context.identity}-${encodeURIComponent(id)}`;
                ids.set(id, scoped);
                node.id = scoped;
              }
              for (const node of clone.querySelectorAll<HTMLElement>("*")) {
                const authored = node.getAttribute("data-af-id");
                if (authored)
                  node.setAttribute(
                    "data-af-id",
                    this.identity(
                      JSON.stringify(["template", key, column.col, authored]),
                    ),
                  );
                for (const attr of [
                  "for",
                  "aria-labelledby",
                  "aria-describedby",
                  "aria-controls",
                  "headers",
                ]) {
                  const value = node.getAttribute(attr);
                  if (value)
                    node.setAttribute(
                      attr,
                      value
                        .split(/\s+/)
                        .map((id) => ids.get(id) ?? id)
                        .join(" "),
                    );
                }
                const href = node.getAttribute("href");
                if (href?.startsWith("#") && ids.has(href.slice(1)))
                  node.setAttribute("href", `#${ids.get(href.slice(1))}`);
              }
              td.append(clone);
            }
            for (const field of td.querySelectorAll<HTMLElement>(
              "[data-field]",
            ))
              field.textContent = String(row[field.dataset.field!] ?? "");
          } else {
            const text = formatCell(row[column.col], column);
            if (
              td.dataset.text !== text ||
              td.dataset.barValue !==
                String(barFraction(row[column.col], column))
            ) {
              td.replaceChildren();
              const fraction = barFraction(row[column.col], column);
              if (fraction !== null) {
                const bar = document.createElement("span");
                bar.dataset.bar = "";
                bar.setAttribute("aria-hidden", "true");
                bar.style.width = `${fraction * 100}%`;
                bar.style.background =
                  typeof column.bar === "object"
                    ? (column.bar.color ?? "var(--chart-1)")
                    : "var(--chart-1)";
                td.append(bar);
              }
              const content = document.createElement("span");
              content.dataset.slot = "cell-content";
              content.textContent = text;
              if (
                column.kind === "image" &&
                typeof row[column.col] === "string"
              ) {
                const src = this.resolveSrc?.(row[column.col] as string);
                if (src) {
                  const image = document.createElement("img");
                  image.src = src;
                  image.alt = "";
                  image.loading = "lazy";
                  image.style.cssText =
                    "max-height:2rem;width:auto;vertical-align:middle";
                  content.replaceChildren(image);
                }
              } else if (
                column.type === "timestamp" &&
                typeof row[column.col] === "string"
              ) {
                const time = document.createElement("time");
                time.dateTime = row[column.col] as string;
                time.textContent = text;
                content.replaceChildren(time);
              }
              td.append(content);
              td.dataset.text = text;
              td.dataset.barValue = String(fraction);
            }
          }
        }
        if (tr.cells[columns.indexOf(column)] !== td)
          tr.insertBefore(td, tr.cells[columns.indexOf(column)] ?? null);
      }
      for (const td of Array.from(tr.cells))
        if (!wanted.has(td.dataset.column!)) td.remove();
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
    for (const [key, row] of this.rows)
      if (!active.has(key)) {
        this.rowObserver?.unobserve(row);
        this.rows.delete(key);
      }
    if (focused?.isConnected && this.ownerDocument.activeElement !== focused)
      focused.focus({ preventScroll: true });
    if (!ordered.length) {
      const td = body.insertRow().insertCell();
      td.className = DATA_TABLE_CLASSES.cell;
      td.colSpan = Math.max(1, columns.length);
      td.textContent = this.pending ? "loading rows…" : "no rows";
    }
    if (this.virtualized && this.columnsNeedMeasurement) {
      // Measure the retained window in natural table layout. A spacer preserves the
      // scroll extent while positioning the same live nodes outside normal flow;
      // no focused control or renderer is cloned, removed, or recreated.
      const viewport = this.viewport!, scrollTop = viewport.scrollTop;
      const spacer = document.createElement("div");
      spacer.style.height = `${viewport.scrollHeight}px`;
      spacer.setAttribute("aria-hidden", "true");
      const elements: HTMLElement[] = [viewport, table, table.tHead!, head, body, ...Array.from(body.rows)];
      const styles = elements.map(element => element.style.cssText);
      viewport.append(spacer);
      try {
        viewport.style.position = "relative";
        table.style.cssText += ";display:table;position:absolute;top:0;left:0;width:100%";
        table.tHead!.style.display = "table-header-group";
        head.style.cssText = "display:table-row";
        body.style.cssText = "display:table-row-group";
        for (const row of Array.from(body.rows)) row.style.cssText = "display:table-row";
        const widths = columns.map((_, index) => head.cells[index]?.getBoundingClientRect().width ?? 0);
        if (widths.some(width => width > 0)) this.measuredHeaderWidths = widths;
      } finally {
        elements.forEach((element, index) => { element.style.cssText = styles[index]!; });
        spacer.remove();
        viewport.scrollTop = scrollTop;
      }
      this.columnsNeedMeasurement = false;
      this.render();
      return;
    }
    if (!this.virtualized) {
      const widths = columns.map((_, index) => head.cells[index]?.getBoundingClientRect().width ?? 0);
      if (widths.some((width) => width > 0)) this.measuredHeaderWidths = widths;
      this.columnsNeedMeasurement = false;
    }
    if (!this.virtualized && !this.virtualizationPending) {
      this.virtualizationPending = true;
      queueMicrotask(() => {
        this.virtualizationPending = false;
        if (this.isConnected) {
          this.virtualized = true;
          this.render();
        }
      });
    }
    table.setAttribute("aria-colcount", String(columns.length));
    table.setAttribute(
      "aria-rowcount",
      String((this.data.totalRows ?? ordered.length) + 1),
    );
    if (this.pending) this.footer!.append("loading rows…");
    else if (
      this.showRowCount ||
      this.data.truncated ||
      (this.data.totalRows ?? 0) > this.data.rows.length
    ) {
      const count = document.createElement("span");
      count.setAttribute("aria-label", "Row count");
      count.dataset.slot = "row-count";
      count.style.lineHeight = "1rem";
      const format = new Intl.NumberFormat();
      count.textContent = `${format.format(this.data.rows.length)} of ${format.format(this.data.totalRows ?? this.data.rows.length)} rows`;
      this.footer!.append(count);
    }
    if (
      this.source &&
      !this.pending &&
      (this.data.truncated ||
        (this.data.totalRows ?? 0) > this.data.rows.length)
    ) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "load more";
      button.setAttribute("aria-label", "Load more rows");
      button.style.cssText =
        "font:inherit;color:inherit;background:none;border:0;cursor:pointer;padding:0;text-underline-offset:2px";
      button.style.setProperty("font-weight", "500", "important");
      button.onmouseenter = () => (button.style.textDecoration = "underline");
      button.onmouseleave = () => (button.style.textDecoration = "");
      button.onclick = () => void this.loadMore();
      this.footer!.append(button);
    }
  }
}
const dataTableStyles = `af-data-table{display:flex;flex-direction:column;width:100%;min-width:0;box-sizing:border-box;overflow:hidden;border:1px solid var(--border,#ddd);border-radius:var(--radius,.375rem);background:var(--card,var(--background,#fff));color:var(--foreground,#222);font:inherit;font-size:.875rem;line-height:1.4285714285714286}af-data-table[data-af-fill]{height:100%}af-data-table [data-slot=table-scroll]{flex:1 1 auto;width:100%;overflow:auto;position:relative;min-height:0}af-data-table table.af-data-table__table{display:table;width:100%;max-width:none;border-collapse:collapse;font-size:inherit;line-height:inherit}af-data-table thead{background:var(--card,var(--background,#fff));color:var(--muted-foreground,#666);z-index:1}af-data-table th.af-data-table__header-cell{min-width:0;overflow:hidden;text-overflow:ellipsis;text-align:left;padding:.5rem .75rem;font-weight:700;white-space:nowrap;border-bottom:1px solid var(--border,#ddd);cursor:pointer}af-data-table th.af-data-table__header-cell:focus-visible{outline:2px solid var(--ring,#777);outline-offset:-2px}af-data-table td.af-data-table__cell{position:relative;min-width:0;overflow:hidden;padding:.375rem .75rem;white-space:nowrap;border-bottom:1px solid color-mix(in srgb,var(--border,#ddd) 50%,transparent);box-sizing:border-box;vertical-align:middle}af-data-table tbody tr:hover{background:color-mix(in srgb,var(--muted,#eee) 30%,transparent)}af-data-table [data-bar]{position:absolute;top:.25rem;bottom:.25rem;left:.25rem;opacity:.25;pointer-events:none;border-radius:.125rem}af-data-table table[data-layout=comparison] th:first-child{position:sticky;left:0;z-index:1;background:var(--card,var(--background,#fff))}af-data-table [data-slot=cell-content]{position:relative}af-data-table small{display:block;color:var(--muted-foreground,#666)}af-data-table [data-slot=table-footer]:not(:empty){display:flex;align-items:center;justify-content:space-between;gap:.75rem;border-top:1px solid var(--border,#ddd);padding:.375rem .75rem;font-size:.75rem;color:var(--muted-foreground,#666)}`;
export function registerDataTable(
  registry: CustomElementRegistry = customElements,
  document: Document = globalThis.document,
): void {
  if (!document.querySelector("style[data-af-data-table-styles]")) {
    const style = document.createElement("style");
    style.setAttribute("data-af-data-table-styles", "");
    style.textContent = dataTableStyles;
    document.head.append(style);
  }
  if (!registry.get("af-data-table"))
    registry.define("af-data-table", AfDataTable);
}

/**
 * <af-data-table>: sortable, virtualized table; the app owns edits, drafts and transport.
 * Usage: import '@afbin/data-table';  (registers the tags; this .ts is the readable contract)
 * Props: sql="SELECT …" (SQLite over the page's linked datasets, as the reader, through
 *   @afbin/apollo's sql.watch as af-chart: read on connect and when it changes, reread when a
 *   dataset it names changes; sorted client-side over the answer, cut at the read's row limit);
 *   data={rows,columns,totalRows?,truncated?} (columns are schema {name,type});
 *   columns=[{col,title,fmt}] (display); rowKey / row-key (stable, unique); sort={col,dir};
 *   height (default 420); sticky (default true, "false" turns it off); transpose (comparison
 *   layout with header, metrics, edge); label (aria-label); cellRenderers {col: fn}; templates
 *   [{col,template}]; columnIdentities {col: {afId,id?}}; resolveSrc(url) for image columns;
 *   source.read({offset,limit,sort,signal}) returns {rows,columns,totalRows?,truncated?}; error
 *   (a SqlError; data clears it): a failed read shows its message (an alert), never "no rows",
 *   its code as data-af-error. A truncated answer draws with its row count. Rows straight
 *   from `sql` (or data.source) get a Live / Snapshot label (lib/html-component-specs data-source).
 * Events: af-sort-change (detail: sort) and af-edit-intent (detail: {row,key,column,value}).
 *   The table draws no editor and never fires af-edit-intent itself: it fires only when a cell
 *   renderer calls context.edit(value) (e.g. from an Edit button it returns).
 * Examples:
 *   table.data={rows:[{id:1,name:"Ada"}],columns:[{name:"id",type:"number"},
 *     {name:"name",type:"string"}]};
 *   table.rowKey="id";
 *   <af-data-table label="Open tasks" sql="select title, due from tasks where not done"
 *     columns='[{"col":"due","title":"Due"}]'></af-data-table>
 * Gotchas: keep state and record identity outside virtualized cells: offscreen rows are
 *   unmounted, so durable editing sessions belong to the caller. A renderer gets a stable
 *   identity; returning a Node replaces the content, returning void updates the cell in place.
 *   Replacing data keeps keyed DOM but remeasures geometry. Light DOM, styled by injected CSS.
 */
import { registerComponent } from './register-component';
import { parseSortSpec, type SortSpec } from "@/lib/html-components/table-values";
import {
  createTableState, dataTableStyles, emptyTable, loadTableRows, renderTable,
} from "./data-table-frame";
import { cancelResizeRender, failTable, invalidateMeasurements } from "./data-table-measure";
import { sourceLabel, sourceOf } from "@/lib/html-component-specs/data-source";
import { DataSourceSlot, dataSourceStyles } from "./data-source-label";
import { TableSqlRead } from "./data-table-sql";
import {
  freezeColumnIdentities, type TableColumnIdentity, type TableData, type TableSource,
  type TableCellRenderer, type TableTemplate,
} from "./table-model";
export type { TableColumnIdentity } from "./table-model";
interface DataTableContract {
  /** Column measurement waits for a connected table and repeats when its data changes. Header
   * line height follows its font scale. */
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
export class AfDataTable extends HTMLElement implements DataTableContract {
  static observedAttributes = [
    "label", "height", "sticky", "transpose", "header", "edge", "row-key", "columns", "sort",
    "metrics", "sql",
  ];
  // All mutable state lives in one record shared with the render modules (data-table-*.ts).
  private s = createTableState(() => this.render());
  resolveSrc?: (url: string) => string | null;
  get data() { return this.s.value; }
  set data(v: TableData) {
    const s = this.s;
    // Cancel any in-flight page; its late result must not overwrite the new data.
    s.loader.cancel();
    ++s.requestEpoch;
    if (s.viewport && (v?.rows.length ?? 0) < s.value.rows.length) s.viewport.scrollTop = 0;
    s.value = v ?? emptyTable();
    // Keep the current keyed window stable until observers report new heights.
    invalidateMeasurements(s, true);
    s.columnsNeedMeasurement = true;
    s.showRowCount = Boolean(s.value.truncated || (s.value.totalRows ?? 0) > s.value.rows.length);
    failTable(this, s, null);
    s.pending = false;
    this.render();
  }
  set error(v: unknown) { failTable(this, this.s, v ?? null); this.render(); }
  get columns() { return this.s.specs; }
  set columns(v: unknown) { this.s.specs = v; this.render(); }
  get columnIdentities() { return this.s.headerIdentities; }
  set columnIdentities(value: Readonly<Record<string, TableColumnIdentity>>) {
    this.s.headerIdentities = freezeColumnIdentities(value);
    this.render();
  }
  get sort() { return this.s.order; }
  set sort(v: SortSpec | null) {
    const s = this.s;
    s.order = parseSortSpec(v);
    if (s.viewport) s.viewport.scrollTop = 0;
    if (this.source && this.isConnected) {
      s.loader.cancel();
      ++s.requestEpoch;
      s.pending = false;
      void this.loadMore(true);
    } else this.render();
  }
  get source() { return this.s.transport; }
  set source(v: TableSource | undefined) {
    const s = this.s;
    s.loader.cancel();
    ++s.requestEpoch;
    s.transport = v;
    s.showRowCount = false;
    s.pending = false;
    failTable(this, s, null);
    if (v) {
      s.value = emptyTable();
      if (s.viewport) s.viewport.scrollTop = 0;
    }
    if (v && this.isConnected) void this.loadMore(true);
    else this.render();
  }
  get cellRenderers() { return this.s.renderers; }
  set cellRenderers(v: Record<string, TableCellRenderer>) { this.s.renderers = v; this.render(); }
  get templates() { return this.s.templateList; }
  set templates(v: TableTemplate[]) { this.s.templateList = v; this.render(); }
  get transpose() { return this.hasAttribute("transpose"); }
  set transpose(v: boolean) { this.toggleAttribute("transpose", v); }
  get edge() { return this.hasAttribute("edge"); }
  set edge(v: boolean) { this.toggleAttribute("edge", v); }
  get sticky() { return this.getAttribute("sticky") !== "false"; }
  set sticky(v: boolean) { this.setAttribute("sticky", String(v)); }
  get height() { return this.getAttribute("height") ?? 420; }
  set height(v: number | string) { this.setAttribute("height", String(v)); }
  get header() { return this.getAttribute("header") ?? undefined; }
  set header(v: string | undefined) { this.optional("header", v); }
  get rowKey() { return this.getAttribute("row-key") ?? undefined; }
  set rowKey(v: string | undefined) { this.optional("row-key", v); }
  private optional(name: string, v: string | undefined) {
    if (v === undefined) this.removeAttribute(name); else this.setAttribute(name, v);
  }
  get metrics() { return this.s.metricSpecs; }
  set metrics(v: unknown) { this.s.metricSpecs = v; this.render(); }
  connectedCallback() {
    // Properties set before the element upgraded shadow the accessors; re-apply them.
    for (const key of [
      "data", "columns", "columnIdentities", "sort", "source", "cellRenderers", "templates",
      "metrics", "rowKey", "height", "sticky", "transpose", "header", "edge", "error",
    ] as const) {
      if (!Object.hasOwn(this, key)) continue;
      const own = this as unknown as Record<string, unknown>, v = own[key];
      delete own[key];
      own[key] = v;
    }
    this.sqlRead.open(this.getAttribute("sql"));
    if (this.source && !this.s.pending && !this.data.rows.length) void this.loadMore(true);
    else this.render();
  }
  disconnectedCallback() {
    const s = this.s;
    this.sqlRead.stop();
    s.loader.cancel();
    ++s.requestEpoch;
    s.pending = false;
    s.viewportObserver?.disconnect();
    s.viewportObserver = undefined;
    s.rowObserver?.disconnect();
    s.rowObserver = undefined;
    cancelResizeRender(s);
  }
  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (name === "sql") return void (this.isConnected && this.sqlRead.open(value));
    if (["columns", "sort", "metrics"].includes(name)) {
      let v: unknown;
      try { v = JSON.parse(value ?? "null"); } catch { v = value; }
      if (name === "sort") return void (this.sort = parseSortSpec(v));
      if (name === "columns") this.s.specs = v; else this.s.metricSpecs = v;
    }
    this.render();
  }
  /** Fetches the next 500 rows from source (or the first page when replace is true). */
  loadMore(replace = false): Promise<void> {
    return loadTableRows(this, this.s, replace);
  }
  private readonly sourceSlot = new DataSourceSlot(this);
  private readonly sqlRead = new TableSqlRead(this);
  private render() {
    renderTable(this, this.s);
    if (!this.isConnected) return;
    const from = sourceOf(this.s.value.rows) ?? sourceOf(this.s.value);
    this.sourceSlot.show(sourceLabel([from], this.getAttribute("data-af-error")));
  }
}
registerComponent({
  styleKey: 'af-data-table-styles',
  styles: dataTableStyles + dataSourceStyles +
    "af-data-table>.af-data-source{align-self:flex-start;padding:.375rem .75rem}",
  elements: { 'af-data-table': AfDataTable },
});

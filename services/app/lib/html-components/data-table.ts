/**
 * <af-data-table>: sortable, virtualized table; the app owns edits, drafts and transport.
 * Usage: import '@afbin/data-table';  (registers the tags; this .ts is the readable contract)
 * Props: data={rows,columns,totalRows?,truncated?} (columns are schema {name,type});
 *   columns=[{col,title,fmt}] (display); rowKey / row-key (stable, unique); sort={col,dir};
 *   height (default 420); sticky (default true, "false" turns it off); transpose (comparison
 *   layout with header, metrics, edge); label (aria-label); cellRenderers {col: fn}; templates
 *   [{col,template}]; columnIdentities {col: {afId,id?}}; resolveSrc(url) for image columns;
 *   source.read({offset,limit,sort,signal}) returns {rows,columns,totalRows?,truncated?}.
 * Events: af-sort-change (detail: sort) and af-edit-intent (detail: {row,key,column,value}).
 * Examples:
 *   table.data={rows:[{id:1,name:"Ada"}],columns:[{name:"id",type:"number"},
 *     {name:"name",type:"string"}]};
 *   table.rowKey="id";
 * Gotchas: keep state and record identity outside virtualized cells: offscreen rows are
 *   unmounted, so durable editing sessions belong to the caller. A renderer gets a stable
 *   identity; returning a Node replaces the content, returning void updates the cell in place.
 *   Replacing data keeps keyed DOM but remeasures geometry. Light DOM, styled by injected CSS.
 */
import { registerComponent } from './register-component';
import { parseSortSpec, type SortSpec } from "@/lib/story-ui/data-table";
import {
  createTableState, dataTableStyles, emptyTable, loadTableRows, renderTable,
} from "./data-table-frame";
import { invalidateMeasurements } from "./data-table-measure";
import {
  freezeColumnIdentities, type TableColumnIdentity, type TableData, type TableSource,
  type TableCellRenderer, type TableTemplate,
} from "./table-model";
export type { TableColumnIdentity } from "./table-model";
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
export class AfDataTable extends HTMLElement implements DataTableContract {
  /** Custom renderers receive a stable identity and own drafts/capabilities. A returned
   * Node replaces the content; returning void updates the existing cell in place.
   * Offscreen rows are unmounted, so durable editing sessions belong to the caller. */
  static observedAttributes = [
    "label", "height", "sticky", "transpose", "header", "edge", "row-key", "columns", "sort",
    "metrics",
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
    s.error = "";
    s.pending = false;
    this.render();
  }
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
    s.error = "";
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
  set header(v: string | undefined) {
    if (v === undefined) this.removeAttribute("header");
    else this.setAttribute("header", v);
  }
  get rowKey() { return this.getAttribute("row-key") ?? undefined; }
  set rowKey(v: string | undefined) {
    if (v === undefined) this.removeAttribute("row-key");
    else this.setAttribute("row-key", v);
  }
  get metrics() { return this.s.metricSpecs; }
  set metrics(v: unknown) { this.s.metricSpecs = v; this.render(); }
  connectedCallback() {
    // Properties set before the element upgraded shadow the accessors; re-apply them.
    for (const key of [
      "data", "columns", "columnIdentities", "sort", "source", "cellRenderers", "templates",
      "metrics", "rowKey", "height", "sticky", "transpose", "header", "edge",
    ] as const) {
      if (Object.hasOwn(this, key)) {
        const v = this[key];
        delete (this as unknown as Record<string, unknown>)[key];
        (this as unknown as Record<string, unknown>)[key] = v;
      }
    }
    if (this.source && !this.s.pending && !this.data.rows.length) void this.loadMore(true);
    else this.render();
  }
  disconnectedCallback() {
    const s = this.s;
    s.loader.cancel();
    ++s.requestEpoch;
    s.pending = false;
    s.viewportObserver?.disconnect();
    s.viewportObserver = undefined;
    s.rowObserver?.disconnect();
    s.rowObserver = undefined;
  }
  attributeChangedCallback(name: string, _old: string | null, value: string | null) {
    if (["columns", "sort", "metrics"].includes(name)) {
      let v: unknown;
      try {
        v = JSON.parse(value ?? "null");
      } catch {
        v = value;
      }
      if (name === "columns") this.s.specs = v;
      else if (name === "sort") {
        this.sort = parseSortSpec(v);
        return;
      } else this.s.metricSpecs = v;
    }
    this.render();
  }
  /** Fetches the next 500 rows from source (or the first page when replace is true). */
  loadMore(replace = false): Promise<void> {
    return loadTableRows(this, this.s, replace);
  }
  private render() {
    renderTable(this, this.s);
  }
}
registerComponent({
  styleKey: 'af-data-table-styles',
  styles: dataTableStyles,
  elements: { 'af-data-table': AfDataTable },
});

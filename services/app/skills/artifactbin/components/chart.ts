/**
 * <af-chart>: one analytical chart (Vega-Lite or Vega) over SQL, a linked dataset or rows.
 * Usage: import '@afbin/chart';  (registers the tag; this .ts is the readable contract)
 * Props: chart: a Vega-Lite spec (bare or {vegaLite}), a Vega spec (bare or {vega}) or a recipe
 *   {recipe, bindings, params?}, an object or JSON, or a <script type="application/json"> child.
 *   Data, exactly one of: sql="SELECT …" (SQLite over the page's linked datasets, as the reader,
 *   rerun when one it names changes); query (a statement from the sql tag of @afbin/apollo,
 *   ${…} bound; set it again to re-query, e.g. on a filter); dataset="NAME" (a link's
 *   data-af-name, every row); rows (an array of objects); none: the spec's own data.values.
 *   height (px, default 320; a spec's own height wins); label (aria-label; else the spec's
 *   description or title); table="false" (no values table); data-name (the Vega dataset rows
 *   fill when the spec has no `main`); draw (replaces the renderer: gets {host, rows, columns,
 *   tokens, width, height, signal}, may return {finalize()}); view (read only: the Vega View).
 * Events: af-chart-ready (detail {view, rows}) after every drawing; af-chart-error (detail
 *   {code, message, detail}): message (for the reader) replaces the drawing, code is also
 *   data-af-error, detail is what to fix; cut-off rows draw with a note. data-af-chart="ready"
 *   marks a drawn chart (absent while loading, empty or failed); aria-busy="true" a read or
 *   drawing in flight.
 * Examples:
 *   <af-chart label="Revenue by region" sql="select region, sum(amount) as total from orders
 *     group by region order by total desc"><script type="application/json">{"mark":"bar",
 *     "encoding":{"x":{"field":"region","type":"nominal","sort":null,"title":"Region"},
 *     "y":{"field":"total","type":"quantitative","title":"Revenue"}}}</script></af-chart>
 *   chart.query = sql`select week, count(*) as n from orders where city = ${city} group by week`;
 *   chart.addEventListener('af-chart-ready', e => e.detail.view.addEventListener('click', f));
 * Gotchas: rows bind as the dataset `main`: give the spec no data (or {name:'main'}); a spec with
 *   its own values draws those. Width follows the element; the theme is the page's tokens, light
 *   or dark, rebuilt when they change; a spec's own config wins. Added at draw time, never saved:
 *   container size and fit autosize on single and layered views, a one-entry legend on a
 *   colourless chart, click-to-highlight legends (param mx_legend_sel; your own params or opacity
 *   opt out), flush heatmap bands, legends wrapped to three rows then "+N more", slanted crowded
 *   x labels, container-sized facets; label widths are a monospace estimate. Refused: url
 *   anywhere (data, images), past 10,000 rows (aggregate in SQL). Recipes: funnel, waterfall,
 *   radar, trend, single-value, combo. Maps are deck.gl. Raw @afbin/vega stays importable
 *   (parse(spec, config, {ast:true}), View with expressionInterpreter); a host page maps
 *   @afbin/vega, @afbin/vega-lite and @afbin/apollo in its own import map.
 */
import { parseChartDescription } from '@/lib/html-component-specs/chart-spec';
import { registerComponent } from './register-component';
import { chartStyles } from './chart-styles';
import {
  descriptionInput, heightOf, readTokens, slotOf, upgradeProperties, type ChartRows,
} from './chart-model';
import { chooseSource, openSource, type ChartStatement } from './chart-data';
import { ChartFrame, endDrawing, observeChart } from './chart-frame';
import { buildChart, chartModules, resizeChart, resolveSpec, type ChartDraw } from './chart-render';
export type { ChartDrawContext } from './chart-render';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
type Loaded = { rows: ChartRows; columns: string[]; sourced: boolean; truncated: boolean };

export class AfChart extends HTMLElement {
  static observedAttributes = ['sql', 'dataset', 'height', 'label', 'table', 'data-name'];
  private chartValue: unknown = undefined;
  private queryValue: ChartStatement | null = null;
  private rowsValue: ChartRows | null = null;
  private drawValue: ChartDraw | null = null;
  private data: Loaded | null = null;
  private frame = new ChartFrame(this);
  private close = () => {}; private cleanups: Array<() => void> = [];
  /** Bumped by every new source, drawing and failure: older async work then drops its result. */
  private epoch = 0;
  private queued = false;
  private width = 0;
  private theme = '';

  get chart(): unknown { return this.chartValue; }
  set chart(value: unknown) { this.chartValue = value; this.schedule(); }
  get query(): ChartStatement | null { return this.queryValue; }
  set query(value: ChartStatement | null) { this.queryValue = value ?? null; this.open(); }
  get rows(): ChartRows | null { return this.rowsValue; }
  set rows(value: ChartRows | null) { this.rowsValue = value ?? null; this.open(); }
  get draw(): ChartDraw | null { return this.drawValue; }
  set draw(value: ChartDraw | null) { this.drawValue = value ?? null; this.schedule(); }
  /** The live Vega View of the current drawing (null before one, after an error, under `draw`). */
  get view() { return this.frame.built?.view ?? null; }

  connectedCallback(): void {
    upgradeProperties(this, ['chart', 'query', 'rows', 'draw']);
    this.frame.attach();
    this.cleanups.push(observeChart(this, () => this.resized(), () => {
      if (this.data && JSON.stringify(readTokens(this)) !== this.theme) this.schedule();
    }));
    if (!this.drawValue) void chartModules.vega().catch(() => {});
    this.open();
  }

  disconnectedCallback(): void {
    this.epoch++;
    this.close();
    this.close = () => {};
    this.frame.clear();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.removeAttribute('data-af-chart');
    this.removeAttribute('aria-busy');
  }

  attributeChangedCallback(name: string, before: string | null, after: string | null): void {
    if (!this.isConnected || before === after) return;
    if (name === 'sql' || name === 'dataset') this.open();
    else if (name === 'label') this.frame.label(this.spec());
    else if (name === 'table') this.frame.table();
    else this.schedule();
  }

  private spec(): Record<string, unknown> | null {
    const parsed = parseChartDescription(descriptionInput(this, this.chartValue) ?? {});
    return parsed.ok && parsed.value.kind !== 'recipe' ? parsed.value.spec : null;
  }

  private measure(): number { return Math.floor(this.clientWidth) || 640; }

  /** A new width resizes the view in place unless the layout plan changes; then it rebuilds. */
  private resized(): void {
    const width = this.measure();
    if (!this.data || Math.abs(width - this.width) < 1) return;
    this.width = width;
    const built = this.frame.built;
    if (built && !this.frame.busy
      && resizeChart(built, this.data.rows, width, heightOf(this))) return;
    this.schedule();
  }

  /** (Re)start the data source: what the chart showed stays until the new rows are drawn. */
  private open(): void {
    this.close();
    this.close = () => {};
    this.data = null;
    this.epoch++;
    if (!this.isConnected) return;
    this.frame.state('Loading chart…', 'loading');
    const source = chooseSource(this.getAttribute('sql'), this.getAttribute('dataset'),
      this.queryValue, this.rowsValue);
    if ('error' in source) return this.fail(source.error);
    this.close = openSource(source, chartModules, (rows, columns, truncated) => {
      this.data = { rows, columns, sourced: source.kind !== 'none', truncated };
      this.schedule();
    }, problem => this.fail(problem));
  }

  private schedule(): void {
    if (this.queued || !this.isConnected) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; void this.render(); });
  }

  private async render(): Promise<void> {
    const epoch = ++this.epoch, data = this.data;
    if (!this.isConnected || !data) return;
    const height = heightOf(this), width = this.width = this.measure(), tokens = readTokens(this);
    this.theme = JSON.stringify(tokens);
    this.frame.busy = true;
    const box = this.ownerDocument.createElement('div');
    try {
      if (this.drawValue) return await this.drawWith(this.drawValue, data, box, epoch);
      const input = descriptionInput(this, this.chartValue);
      if (input === undefined) {
        return this.frame.state('Waiting for a chart description: set chart or add a ' +
          '<script type="application/json"> child.', 'idle');
      }
      const parsed = parseChartDescription(input);
      if (!parsed.ok) throw new Error(parsed.error);
      if (data.sourced && data.rows.length === 0) return this.frame.state('No rows', 'empty');
      const resolved = await resolveSpec(parsed.value, data.rows);
      if (epoch !== this.epoch) return;
      this.frame.plot.append(box);
      const built = await buildChart({ resolved, rows: data.rows, box, width, height, tokens,
        sourced: data.sourced, dataName: this.getAttribute('data-name') });
      if (epoch !== this.epoch) return void (built?.view.finalize(), box.remove());
      if (!built) return void (box.remove(), this.frame.state('No rows', 'empty'));
      this.frame.show(data.rows, data.columns, resolved.spec, built, box, data.truncated);
      this.frame.size(slotOf(resolved, width, height).height);
    } catch (error) {
      box.remove();
      if (epoch === this.epoch) this.fail(`chart not drawn: ${message(error)}`);
    }
  }

  /** `draw` replaces the renderer; the element still owns the rows, size, states and teardown. */
  private async drawWith(draw: ChartDraw, data: Loaded, box: HTMLElement, epoch: number) {
    const abort = new AbortController(), height = heightOf(this);
    this.frame.clear();
    this.frame.size(height);
    this.frame.plot.append(box);
    const result = await draw({ host: box, rows: data.rows, columns: data.columns,
      tokens: JSON.parse(this.theme), width: this.width, height, signal: abort.signal });
    if (epoch !== this.epoch) return void (abort.abort(), endDrawing(result));
    this.frame.show(data.rows, data.columns, this.spec(), { result, abort }, box, data.truncated);
    this.frame.size(height);
  }

  private fail(problem: Parameters<ChartFrame['fail']>[0]): void {
    this.epoch++;
    this.frame.fail(problem);
  }
}

registerComponent({ styleKey: 'af-chart-styles', styles: chartStyles,
  elements: { 'af-chart': AfChart } });

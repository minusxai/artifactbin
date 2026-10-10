/**
 * CHARTS DRAWN ON THE SERVER (docs/phase2-architecture.md §1, §5; contract `DrawnChart`).
 *
 * A `<Question>` chart drawn to SVG from a snapshot's rows with vega on the
 * server (`renderer: 'none'`, `view.toSVG()`), so a reader sees the chart in
 * the HTML and Vega loads in the browser only when the table changes or the
 * reader interacts. The spec is built exactly as the browser builds it
 * (QuestionEmbed's envelope, then lib/viz/render-vega's resolve → legend /
 * label / facet plans → themed compile → view), minus what only a browser has:
 * the container's size (given), the theme's computed CSS tokens, tooltips and
 * the hover guide.
 *
 * A chart it cannot draw faithfully is REFUSED (thrown), never approximated:
 * the island then draws it in the browser. Refused: an unknown
 * or unresolvable viz, a spec vega reports errors for, a spec that still needs
 * a CSS custom property (`var(--…)`) only the page can resolve, a map with
 * street tiles or geo boundaries (network assets), and any SVG that carries a
 * script, a foreign object, an event-handler attribute or a `javascript:` URL.
 *
 * Deterministic for one input and host; no I/O. Temporal axes are formatted in
 * the process's time zone, as vega does everywhere.
 */
import { createHash } from 'node:crypto';
import type { JsxAttribute, JsxNode } from '@/lib/jsx';
import { CHART_VIZ_KINDS } from '@/lib/document';
import { refName, type TableResult, type RefDataMap } from '@/lib/dataflow';
import { questionEmbedHeightPx } from '@/lib/data/story/question-height';
import { inferVizColumnsFromRows } from '@/lib/viz/query-data';
import { questionEnvelope } from '@/lib/viz/chart-envelope';
import { isInteractiveMapEnvelope } from '@/lib/viz/interactive-map';
import { createVegaView, planVega, resolveEnvelopeSpec } from '@/lib/viz/render-vega';
import type { ServedResults } from '@/lib/story-runtime/contract';
import { DRAWING_CLASS } from '@/lib/islands';
import { gridCols, gridItemRect, gridRowHeight } from '@/lib/story-ui/grid-layout';
import type { DrawnChart } from '@/lib/story-runtime/contract';

/** The largest drawing served in the HTML; a chart that draws more (thousands of marks) is drawn by its island. */
const MAX_DRAWING_BYTES = 512 * 1024;

/** QuestionEmbed's title bar (`px-3 py-2 text-sm` + a 1px border): the chart below it gets the rest of the embed's height. */
const TITLE_BAR_PX = 37;

interface DrawChartInput {
  /** The `<Question viz={…}>` prop: `{ kind: 'vega-lite' | 'vega' | 'recipe', … }`. */
  viz: Record<string, unknown>;
  table: Pick<TableResult, 'rows' | 'columns'>;
  width: number;
  height: number;
  colorMode: 'light' | 'dark';
  /** The table's declared name, carried into `DrawnChart.table`. */
  name?: string;
  /** Resolved `ref:` data, for a workspace recipe (`viz.recipe = "ref:<id>"`). */
  refData?: RefDataMap;
  /** The document theme's `--chart-1..5` range, when the caller knows it; null draws the house palette. */
  palette?: string[] | null;
}

/**
 * The digest of a table's rows `DrawnChart.rows` carries: sha256 of the rows'
 * JSON, hex, 16 chars. A client that holds the same rows (parsed from the same
 * JSON) computes the same digest, so it can tell a drawing is current.
 */
export function rowsDigest(rows: readonly Record<string, unknown>[]): string {
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex').slice(0, 16);
}

/**
 * The elements vega's SVG writer emits for the charts a snapshot draws. Anything
 * else — a script, a foreign object, a link, an image that would fetch from a
 * guest's browser, or an element an unescaped author string produced — refuses
 * the drawing.
 */
const SVG_ELEMENTS: ReadonlySet<string> = new Set([
  'svg', 'g', 'path', 'rect', 'line', 'text', 'tspan', 'circle', 'ellipse', 'polygon', 'polyline',
  'defs', 'clippath', 'lineargradient', 'radialgradient', 'stop', 'pattern', 'title', 'desc',
]);
/** A tag, its quoted attributes skipped as units so an attribute's escaped text is never read as markup. */
const TAG = /<\s*(\/?)\s*([^\s/>"'=]+)((?:\s+[^\s/>"'=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+))?)*)\s*\/?\s*>/g;
const ATTR = /\s+([^\s/>"'=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

/**
 * Whether a drawing is safe to put in every reader's HTML: only the elements
 * above, no event-handler attribute, no URL-bearing attribute, and no `<` left
 * outside a well-formed tag (text is vega-escaped, so a stray one means an
 * author string escaped it).
 */
function svgIsSafe(svg: string): boolean {
  let covered = 0;
  for (const tag of svg.matchAll(TAG)) {
    if (svg.slice(covered, tag.index).includes('<')) return false;
    covered = tag.index + tag[0].length;
    if (!SVG_ELEMENTS.has(tag[2]!.toLowerCase())) return false;
    for (const attr of (tag[3] ?? '').matchAll(ATTR)) {
      const name = attr[1]!.toLowerCase();
      if (name.startsWith('on') || name === 'href' || name.endsWith(':href') || name === 'src' || name === 'style') return false;
    }
  }
  return !svg.slice(covered).includes('<');
}
/** A CSS custom property the server cannot resolve (render-vega would need the page's computed style). */
const CSS_VAR = /var\(--/;

/**
 * What a compiled spec needs that a server drawing must not do: a link (`href`,
 * which vega sanitises asynchronously and, headless, rejects UNHANDLED for a
 * refused URL — a process-level failure) or an image mark (a fetch).
 */
function needsBrowser(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = needsBrowser(item);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const record = node as Record<string, unknown>;
  if (record.type === 'image') return 'an image mark loads its images in the browser';
  for (const [key, value] of Object.entries(record)) {
    if (key === 'href') return 'linked marks navigate in the browser';
    const found = needsBrowser(value);
    if (found) return found;
  }
  return null;
}

const ID_REF = /\bid="([^"]+)"|url\(#([^)"]+)\)/g;

/**
 * Vega names clip paths and gradients from process-wide counters (`clip7`,
 * `gradient_3`), so the same chart drawn twice differs, and two charts inlined
 * in one page can point at each other's definitions. Every id is renamed to a
 * prefix taken from the drawing itself (with its ids blanked) plus its order:
 * the same chart always gets the same ids, and different charts different ones.
 */
function scopeIds(svg: string): string {
  const order = new Map<string, number>();
  const index = (id: string) => {
    if (!order.has(id)) order.set(id, order.size);
    return order.get(id)!;
  };
  // Only inside tags: text content may hold `"` and could read like an id.
  const inTags = (rewrite: (id: string) => string) => svg.replace(/<[^<>]*>/g, (tag) =>
    tag.replace(ID_REF, (_m, id?: string, ref?: string) => (id !== undefined ? `id="${rewrite(id)}"` : `url(#${rewrite(ref!)})`)));
  const blanked = inTags((id) => String(index(id)));
  if (!order.size) return svg;
  const prefix = `mxc${createHash('sha256').update(blanked).digest('hex').slice(0, 10)}`;
  return inTags((id) => `${prefix}-${index(id)}`);
}

/**
 * The drawing as it is served: the root `<svg>` fills its chart box instead of sizing it
 * (`DRAWING_CLASS`; its viewBox scales the marks). The server draws at the question's nominal size,
 * and the page may make the box smaller (a fixed-height card, a grid cell) or wider; a drawing in the
 * flow would hold the box at its own size until the island redrew it, and the page would move.
 * Its `width`/`height` attributes stay as the size it was drawn at.
 */
function responsive(svg: string): string {
  return svg.replace(/^<svg\b([^>]*)>/, (root, attrs: string) => {
    const cls = /\sclass="([^"]*)"/.exec(attrs);
    const merged = [...(cls?.[1] ? cls[1].split(/\s+/) : []), ...DRAWING_CLASS.split(' ')].join(' ');
    return cls ? root.replace(cls[0], ` class="${merged}"`) : `<svg class="${merged}"${attrs}>`;
  });
}

/** Draw one chart (contract `DrawnChart`). Throws when the chart cannot be drawn faithfully on the server. */
export async function drawChart(input: DrawChartInput): Promise<DrawnChart> {
  const { table, width, height, colorMode } = input;
  // vega and vega-lite mutate the specs they are handed, and `viz` is the prepared page's shared attribute JSON.
  const envelope = questionEnvelope(JSON.parse(JSON.stringify(input.viz)) as Record<string, unknown>, table.columns, input.refData);
  if ('error' in envelope) throw new Error(envelope.error);
  if (isInteractiveMapEnvelope(envelope)) throw new Error('an interactive map draws street tiles in the browser');
  const resolved = resolveEnvelopeSpec(envelope, inferVizColumnsFromRows(table.rows));
  if (!resolved.ok) throw new Error(resolved.error);
  if (resolved.assets && Object.keys(resolved.assets).length) throw new Error('geo boundaries load in the browser');
  const { vegaSpec, parserConfig, facetLayout } = planVega(resolved, table.rows, { width, height }, colorMode, input.palette ?? null);
  // Vega-Lite compiles `width: 'container'` into a signal whose `init` falls
  // back to 300 without a DOM container. Seed that signal before parse: a
  // post-run resize retains stale axis ticks in the SVG scenegraph.
  if (!facetLayout) for (const signal of vegaSpec.signals ?? []) {
    if ('init' in signal && typeof signal.init === 'string' && signal.init.includes('containerSize()')) {
      if (signal.name === 'width') signal.init = String(width);
      if (signal.name === 'height') signal.init = String(height);
    }
  }
  if (CSS_VAR.test(JSON.stringify(vegaSpec))) throw new Error('the spec reads a CSS custom property only the page can resolve');
  const browserOnly = needsBrowser(vegaSpec);
  if (browserOnly) throw new Error(browserOnly);
  const view = createVegaView(vegaSpec, table.rows, { renderer: 'none', width, height, facetLayout, ...(parserConfig ? { parserConfig } : {}) });
  // Vega LOGS dataflow errors instead of rejecting (VegaChart promotes them the same way).
  const errors: unknown[] = [];
  view.logger({
    level(): never { return this as never; },
    error(...args: unknown[]) { errors.push(args[0]); return this; },
    warn() { return this; },
    info() { return this; },
    debug() { return this; },
  } as never);
  try {
    // createVegaView applies the slot dimensions before the first run, exactly
    // as the browser controller does. Running a second time leaves stale axis
    // labels in Vega's SVG scenegraph for container-sized temporal charts.
    await view.runAsync();
    if (errors.length) throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
    const svg = responsive(scopeIds(await view.toSVG()));
    // Megabytes of marks are stored, parsed and assembled into every reader's HTML: the island draws them instead.
    if (svg.length > MAX_DRAWING_BYTES) throw new Error(`the drawing is ${svg.length} bytes, over ${MAX_DRAWING_BYTES}`);
    if (!svgIsSafe(svg)) throw new Error('the drawing carries markup a reader page may not');
    return { svg, table: input.name ?? '', rows: rowsDigest(table.rows) };
  } finally {
    view.finalize();
  }
}

const attr = (el: { attributes: JsxAttribute[] }, name: string) => el.attributes.find((a) => a.name === name)?.value;
const staticAttr = (el: { attributes: JsxAttribute[] }, name: string): unknown => {
  const value = attr(el, name);
  return value?.static ? value.json : undefined;
};

export interface SnapshotChartOptions {
  colorMode: 'light' | 'dark';
  refData?: RefDataMap;
  palette?: string[] | null;
  /** Override the desktop document width for a known caller. */
  width?: number;
  /** The reading wrapper's bounded width for plan documents. */
  template?: string | null;
}

/**
 * Desktop chart-slot geometry. The reader's `.mx-doc` has no width limit except
 * for plan (1120px); at the common 1440px viewport, authored padding and Grid
 * geometry decide the chart slot. Narrow viewports and arbitrary CSS can still
 * resize it, so the SVG remains responsive and Vega measures its actual slot.
 */
function chartLayout(ancestors: readonly JsxNode[], options: SnapshotChartOptions): { width: number; tileHeight?: number } {
  let width = options.width ?? (options.template === 'plan' ? 1120 : 1440);
  let tileHeight: number | undefined;
  let cols = 12;
  let rowHeight = 86;
  let flow = false;
  for (const node of ancestors) {
    if (node.type !== 'element') continue;
    const className = String(staticAttr(node, 'className') ?? staticAttr(node, 'class') ?? '');
    const classes = className.split(/\s+/);
    const maxWidths: Record<string, number> = { 'max-w-sm': 384, 'max-w-md': 448, 'max-w-lg': 512, 'max-w-xl': 576, 'max-w-2xl': 672, 'max-w-3xl': 768, 'max-w-4xl': 896, 'max-w-5xl': 1024, 'max-w-6xl': 1152, 'max-w-7xl': 1280 };
    for (const token of classes) if (maxWidths[token] !== undefined) width = Math.min(width, maxWidths[token]);
    const padding = (prefix: string) => classes.reduce((size, token) => {
      const match = new RegExp(`^(?:${prefix}-|@2xl:${prefix}-)(\\d+)$`).exec(token);
      return match ? Number(match[1]) * 4 : size;
    }, 0);
    const pad = padding('px') || padding('p');
    width -= 2 * pad;
    if (node.tag === 'Grid') {
      cols = gridCols(staticAttr(node, 'cols'));
      rowHeight = gridRowHeight(staticAttr(node, 'rowHeight'));
      flow = staticAttr(node, 'mode') === 'flow';
    } else if (node.tag === 'GridItem') {
      const rect = gridItemRect({ w: staticAttr(node, 'w'), h: staticAttr(node, 'h') }, cols);
      width = Math.floor(width * rect.w / cols) - 6;
      if (!flow) tileHeight = rect.h * rowHeight - 6;
    } else if (node.tag === 'Card') {
      width -= 2; // border
    } else if (node.tag === 'CardContent' && pad === 0 && !classes.includes('px-0')) {
      width -= 48;
    }
  }
  return { width: Math.max(80, Math.floor(width)), ...(tileHeight === undefined ? {} : { tileHeight }) };
}

/**
 * Every `<Question>` chart whose table the snapshot answered, drawn, keyed by
 * the question's node id (or its AST path, the interpreter's `data-mx-ast`, when
 * it has none), in document order. A question that is not a chart, reads a
 * table the snapshot did not answer, or cannot be drawn is left out: the island
 * draws it in the browser.
 */
export async function drawSnapshotCharts(nodes: JsxNode[], results: Pick<ServedResults, 'tables' | 'errors'>, options: SnapshotChartOptions): Promise<Record<string, DrawnChart>> {
  const jobs: Array<{ key: string; name: string; viz: Record<string, unknown>; height: number; width: number }> = [];
  const walk = (list: readonly JsxNode[], prefix: string | null, ancestors: readonly JsxNode[]) => {
    list.forEach((node, i) => {
      const path = prefix === null ? String(i) : `${prefix}.${i}`;
      if (node.type !== 'element') return;
      if (node.isComponent && node.tag === 'Question') {
        const raw = staticAttr(node, 'viz');
        const viz = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
        const name = refName(staticAttr(node, 'data'));
        if (viz && typeof viz.kind === 'string' && CHART_VIZ_KINDS.has(viz.kind) && name && results.tables[name]) {
          const id = staticAttr(node, 'id');
          const titled = typeof staticAttr(node, 'title') === 'string' && staticAttr(node, 'title') !== '';
          const layout = chartLayout(ancestors, options);
          const height = (layout.tileHeight ?? questionEmbedHeightPx(staticAttr(node, 'height'), false)) - (titled ? TITLE_BAR_PX : 0);
          jobs.push({ key: typeof id === 'string' && id ? id : path, name, viz, height, width: layout.width });
        }
      }
      walk(node.children, path, [...ancestors, node]);
    });
  };
  walk(nodes, null, []);
  const drawings: Record<string, DrawnChart> = {};
  for (const job of jobs) {
    if (Object.hasOwn(drawings, job.key)) continue;
    const table = results.tables[job.name]!;
    try {
      drawings[job.key] = await drawChart({
        viz: job.viz, table, name: job.name, colorMode: options.colorMode,
        width: job.width, height: job.height,
        ...(options.refData ? { refData: options.refData } : {}),
        ...(options.palette !== undefined ? { palette: options.palette } : {}),
      });
    } catch {
      // Not drawable on the server: the island draws it, as every undrawn chart is.
    }
  }
  return drawings;
}

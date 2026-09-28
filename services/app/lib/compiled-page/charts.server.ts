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
 * the island then draws it in the browser exactly as today. Refused: an unknown
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
import type { VizEnvelope } from '@/lib/validation/atlas-schemas';
import { refName, type TableResult } from '@/lib/story/dataflow';
import { columnVizKind } from '@/lib/story/dataset-shape';
import type { RefDataMap } from '@/lib/story/ref-data';
import { questionEmbedHeightPx } from '@/lib/data/story/question-height';
import { materializeFileRecipe } from '@/lib/viz/recipe-file';
import { inferVizColumnsFromRows } from '@/lib/viz/query-data';
import { isInteractiveMapEnvelope } from '@/lib/viz/interactive-map';
import { computeFacetLayoutPlan, computeLegendPlan, computeXLabelAngle, createVegaView, resolveEnvelopeSpec, toVegaSpec } from '@/lib/viz/render-vega';
import type { VizResultColumn } from '@/lib/viz/types';
import type { ServedResults } from '@/lib/story-runtime/contract';
import type { DrawnChart } from './contract';

/**
 * The `viz.kind`s whose QuestionEmbed branch draws a Vega chart
 * (lib/story/lazy-code CHART_VIZ_KINDS, not exported there; see the report's contract request).
 */
const CHART_VIZ_KINDS: ReadonlySet<string> = new Set(['vega', 'vega-lite', 'recipe']);

/** The width a snapshot draws at when nothing says how wide the slot is (render-vega's headless default). */
export const SNAPSHOT_CHART_WIDTH = 640;
/** QuestionEmbed's title bar (`px-3 py-2 text-sm` + a 1px border): the chart below it gets the rest of the embed's height. */
const TITLE_BAR_PX = 37;

export interface DrawChartInput {
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

/** QuestionEmbed's envelope for a chart kind (its native, shipped-recipe and `ref:` recipe branches). */
function envelopeOf(viz: Record<string, unknown>, columns: TableResult['columns'], refData: RefDataMap | undefined): VizEnvelope {
  const kind = viz.kind;
  if (kind === 'vega-lite' || kind === 'vega') {
    return { version: 2, source: { kind, grammar: kind === 'vega-lite' ? 'vega-lite@6' : 'vega@6', spec: viz.spec ?? {} } } as unknown as VizEnvelope;
  }
  if (kind === 'recipe' && typeof viz.recipe === 'string' && !viz.recipe.startsWith('ref:')) {
    return {
      version: 2,
      source: {
        kind: 'recipe',
        recipe: viz.recipe,
        bindings: viz.bindings ?? {},
        params: (viz.params ?? null) as Record<string, unknown> | null,
        columnFormats: (viz.columnFormats ?? null) as Record<string, unknown> | null,
      },
    } as unknown as VizEnvelope;
  }
  if (kind === 'recipe' && typeof viz.recipe === 'string') {
    const resolved = refData?.[viz.recipe.slice(4)];
    if (resolved?.kind !== 'viz') throw new Error('recipe unavailable');
    const cols: VizResultColumn[] = columns.map((c) => ({ name: c.name, kind: columnVizKind(c.type) }));
    const m = materializeFileRecipe(resolved.recipe, (viz.bindings ?? {}) as Record<string, string | string[]>, (viz.params ?? null) as Record<string, unknown> | null, cols);
    if (!m.ok) throw new Error(`recipe error: ${m.error}`);
    return { version: 2, source: { kind: m.engine, grammar: m.engine === 'vega-lite' ? 'vega-lite@6' : 'vega@6', spec: m.spec } } as unknown as VizEnvelope;
  }
  throw new Error(`not a chart viz kind: ${String(kind)}`);
}

/** Markup that must never reach a reader's HTML from a drawing. */
const UNSAFE_SVG = /<script|<foreignObject|<[^>]*\son[a-z-]*\s*=\s*["']|javascript:/i;
/** A CSS custom property the server cannot resolve (render-vega would need the page's computed style). */
const CSS_VAR = /var\(--/;

/** Draw one chart (contract `DrawnChart`). Throws when the chart cannot be drawn faithfully on the server. */
export async function drawChart(input: DrawChartInput): Promise<DrawnChart> {
  const { table, width, height, colorMode } = input;
  const envelope = envelopeOf(input.viz, table.columns, input.refData);
  if (isInteractiveMapEnvelope(envelope)) throw new Error('an interactive map draws street tiles in the browser');
  const resolved = resolveEnvelopeSpec(envelope, inferVizColumnsFromRows(table.rows));
  if (!resolved.ok) throw new Error(resolved.error);
  if (resolved.assets && Object.keys(resolved.assets).length) throw new Error('geo boundaries load in the browser');
  const vl = resolved.engine === 'vega-lite' ? resolved.spec : null;
  const legendPlan = vl ? computeLegendPlan(vl, table.rows, width) : null;
  const xLabelAngle = vl ? computeXLabelAngle(vl, table.rows, width) : null;
  const facetLayout = vl ? computeFacetLayoutPlan(vl, table.rows, width, height) : null;
  const { vegaSpec, parserConfig } = toVegaSpec(resolved, colorMode, { legendPlan, xLabelAngle, facetLayout, categoryRange: input.palette ?? null });
  if (CSS_VAR.test(JSON.stringify(vegaSpec))) throw new Error('the spec reads a CSS custom property only the page can resolve');
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
    // A `width: 'container'` spec sizes from its container on the first run; headless
    // there is none, so the size is applied after it and the view runs again.
    await view.runAsync();
    if (!facetLayout) view.width(width).height(height);
    await view.runAsync();
    if (errors.length) throw errors[0] instanceof Error ? errors[0] : new Error(String(errors[0]));
    const svg = await view.toSVG();
    if (UNSAFE_SVG.test(svg)) throw new Error('the drawing carries markup a reader page may not');
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
  /** Default `SNAPSHOT_CHART_WIDTH`. */
  width?: number;
}

/**
 * Every `<Question>` chart whose table the snapshot answered, drawn, keyed by
 * the question's node id (or its AST path, the interpreter's `data-mx-ast`, when
 * it has none), in document order. A question that is not a chart, reads a
 * table the snapshot did not answer, or cannot be drawn is left out: the island
 * draws it in the browser.
 */
export async function drawSnapshotCharts(nodes: JsxNode[], results: Pick<ServedResults, 'tables' | 'errors'>, options: SnapshotChartOptions): Promise<Record<string, DrawnChart>> {
  const jobs: Array<{ key: string; name: string; viz: Record<string, unknown>; height: number }> = [];
  const walk = (list: readonly JsxNode[], prefix: string | null) => {
    list.forEach((node, i) => {
      const path = prefix === null ? String(i) : `${prefix}.${i}`;
      if (node.type !== 'element') return;
      if (node.isComponent && node.tag === 'Question') {
        const viz = staticAttr(node, 'viz');
        const name = refName(staticAttr(node, 'data'));
        if (viz && typeof viz === 'object' && !Array.isArray(viz) && typeof viz.kind === 'string' && CHART_VIZ_KINDS.has(viz.kind) && name && results.tables[name]) {
          const id = staticAttr(node, 'id');
          const titled = typeof staticAttr(node, 'title') === 'string' && staticAttr(node, 'title') !== '';
          const height = questionEmbedHeightPx(staticAttr(node, 'height'), false) - (titled ? TITLE_BAR_PX : 0);
          jobs.push({ key: typeof id === 'string' && id ? id : path, name, viz: viz as Record<string, unknown>, height });
        }
      }
      walk(node.children, path);
    });
  };
  walk(nodes, null);
  const drawings: Record<string, DrawnChart> = {};
  for (const job of jobs) {
    if (Object.hasOwn(drawings, job.key)) continue;
    const table = results.tables[job.name]!;
    try {
      drawings[job.key] = await drawChart({
        viz: job.viz, table, name: job.name, colorMode: options.colorMode,
        width: options.width ?? SNAPSHOT_CHART_WIDTH, height: job.height,
        ...(options.refData ? { refData: options.refData } : {}),
        ...(options.palette !== undefined ? { palette: options.palette } : {}),
      });
    } catch {
      // Not drawable on the server: the island draws it, as every chart is drawn today.
    }
  }
  return drawings;
}

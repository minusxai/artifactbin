/**
 * Internal: how af-chart draws. The grammar engines are the page's hosted `@afbin/vega` (its View
 * shows the themed tooltip) and, for Vega-Lite only, `@afbin/vega-lite`; recipes load their
 * builders as a chunk of their own. All are literal dynamic imports, so a chart pays for no
 * engine until it draws, the page's import map resolves them and a download packs them. Views
 * are planned and built by lib/viz/chart-plan, the same code as the query image, with the
 * expression interpreter and a loader that refuses every fetch.
 * Used by: chart.ts.
 */
import type { View } from 'vega';
import type { ChartDescription } from '@/lib/html-component-specs/chart-spec';
import {
  createChartView, declaredDatasets, legendPlanKey, planChart, resizeVegaView,
  type ChartEngines, type ResolvedChartSpec,
} from '@/lib/viz/chart-plan';
import { computeFacetLayoutPlan } from '@/lib/viz/facet-layout';
import type { ChartTokens } from '@/lib/viz/theme';
import { slotOf, type ChartRows, type ChartSlot } from './chart-model';
import type { ChartRuntime } from './chart-data';

type VegaModule = Pick<ChartEngines, 'parse' | 'View' | 'expressionInterpreter'>;
/**
 * The hosted modules af-chart loads, one function each so a test can stand in for them. Each
 * `@afbin/` name is a constant template, which esbuild folds into the literal import("@afbin/…")
 * the page's import map resolves and a download packs (the component build leaves exactly these
 * external: scripts/lib/html-components-build.mjs), while the test transform leaves it alone.
 */
export const chartModules: ChartRuntime & {
  vega(): Promise<VegaModule>;
  vegaLite(): Promise<Pick<ChartEngines, 'compile'>>;
  recipes(): Promise<typeof import('@/lib/viz/chart-resolve')>;
} = {
  vega: () => import(/* @vite-ignore */ `@afbin/${'vega'}`),
  vegaLite: () => import(/* @vite-ignore */ `@afbin/${'vega-lite'}`),
  apollo: () => import(/* @vite-ignore */ `@afbin/${'apollo'}`),
  recipes: () => import('@/lib/viz/chart-resolve'),
};

/** A drawing the element owns until the next one: the view and what a resize needs to know. */
export interface BuiltChart {
  view: View;
  vl: Record<string, unknown> | null;
  legendKey: string;
  slot: ChartSlot;
}

/** The description as a renderable spec: a recipe materializes over the rows. */
export async function resolveSpec(description: ChartDescription,
  rows: ChartRows): Promise<ResolvedChartSpec> {
  if (description.kind !== 'recipe') return { spec: description.spec, engine: description.kind };
  const result = (await chartModules.recipes()).resolveChartDescription(description, rows);
  if (!result.ok) throw new Error(`recipe ${description.recipe}: ${result.error}`);
  return result.resolved;
}

async function loadEngines(engine: ResolvedChartSpec['engine']): Promise<ChartEngines> {
  const [vega, lite] = await Promise.all([chartModules.vega(),
    engine === 'vega-lite' ? chartModules.vegaLite() : null]);
  const compile: ChartEngines['compile'] = lite ? (spec, options) => lite.compile(spec, options)
    : () => { throw new Error('a Vega spec is not compiled'); };
  const { parse, View, expressionInterpreter } = vega;
  return { compile, parse, View, expressionInterpreter };
}

export interface BuildRequest {
  resolved: ResolvedChartSpec;
  rows: ChartRows;
  box: HTMLElement;
  width: number;
  height: number;
  tokens: ChartTokens;
  /** The dataset rows bind to when the spec declares no `main` (the `data-name` attribute). */
  dataName: string | null;
  /** Whether the element was given rows to draw (any source but none). */
  sourced: boolean;
}

/** Plan, build and run one view in `box`; null when the rows it binds are empty. */
export async function buildChart(request: BuildRequest): Promise<BuiltChart | null> {
  const { resolved, rows, box, width, height, tokens } = request;
  const engines = await loadEngines(resolved.engine);
  const slot = slotOf(resolved, width, height);
  const plan = planChart(engines, resolved, rows, { width, height }, tokens);
  const declared = declaredDatasets(plan.vegaSpec);
  const name = declared.includes('main') ? 'main' : request.dataName ?? 'main';
  if (!declared.includes(name) && request.sourced) {
    throw new Error(request.dataName
      ? `the spec declares no dataset named ${request.dataName} (data-name) for the rows`
      : 'the spec carries its own data, so the rows are not drawn: remove its data (rows bind as ' +
        'main) or name the dataset they fill with data-name');
  }
  if (declared.includes(name) && rows.length === 0) return null;
  const view = createChartView(engines, plan.vegaSpec, rows, {
    renderer: 'svg', container: box, width: slot.width, height: slot.height,
    facetLayout: plan.facetLayout, parserConfig: plan.parserConfig, dataName: name,
  });
  try { await view.runAsync(); } catch (error) { view.finalize(); throw error; }
  return { view, vl: plan.vl, legendKey: plan.legendKey, slot };
}

/**
 * Resize a built view in place when the compile-time layout plan (legend wrap, x label angle)
 * is unchanged at `width`; false when the chart must be rebuilt.
 */
export function resizeChart(built: BuiltChart, rows: ChartRows, width: number,
  height: number): boolean {
  if (legendPlanKey(built.vl, rows, width) !== built.legendKey) return false;
  const facetLayout = built.vl && built.slot.facet
    ? computeFacetLayoutPlan(built.vl, rows, width, height) : null;
  resizeVegaView(built.view, {
    width: built.slot.width === undefined ? undefined : width,
    height: built.slot.height === undefined ? undefined : height, facetLayout,
  });
  void built.view.runAsync().catch(() => {});
  return true;
}

/** What a `draw` function receives: the element still loads the rows, sizes and tears down. */
export interface ChartDrawContext {
  host: HTMLElement;
  rows: ChartRows;
  columns: string[];
  tokens: ChartTokens;
  width: number;
  height: number;
  /** Aborted when this drawing is replaced or the element leaves the page. */
  signal: AbortSignal;
}
export type ChartDrawing = void | { finalize?(): void };
export type ChartDraw = (context: ChartDrawContext) => ChartDrawing | Promise<ChartDrawing>;

/**
 * The server's Vega render pipeline: prepare → theme config → vega-lite compile
 * → vega parse (ast) → View (CSP-safe expression interpreter) → the rows bound as `main`.
 *
 * Used headlessly (renderer 'none' → toSVG) for the sparkline image, and through
 * SERVER_ENGINES by the chart image (chart-draw.server), which builds on chart-plan.
 *
 * Security: specs are parsed with {ast: true} and evaluated with
 * vega-interpreter — no generated JavaScript functions, CSP-safe everywhere.
 * External data can't reach this layer: the validator rejects data.url/values, the
 * loader fetches nothing, and the only dataset bound is the query result under its
 * reserved name.
 * TODO: tighten the Vega event config (deny window/timer/selector sources).
 * The shipped interactions use only view-scoped pointer/wheel events, so nothing
 * depends on those sources today.
 */
import { compile } from 'vega-lite';
import type { TopLevelSpec } from 'vega-lite';
import { parse, View } from 'vega';
import type { Spec as VegaSpec } from 'vega';
import { expressionInterpreter } from 'vega-interpreter';
import {
  bindRows, computeLegendPlan, finishCompiledVega, NO_EXTERNAL_LOADER, prepareVegaLite,
  resizeVegaView, type ChartEngines, type ChartTheme, type CompileVegaLiteOptions,
} from './chart-plan';
import { computeFacetLayoutPlan, type FacetLayoutPlan } from './facet-layout';

/** The npm grammar engines, for chart-plan's engine-free builders. */
export const SERVER_ENGINES: ChartEngines = {
  compile: (spec, options) => compile(spec as TopLevelSpec, options as never),
  parse: (spec, config, options) => parse(spec, config as never, options),
  View: View as unknown as ChartEngines['View'],
  expressionInterpreter,
};

interface VegaViewOptions {
  renderer: 'svg' | 'canvas' | 'none';
  width?: number;
  height?: number;
  /** Container-bounded child sizing for a top-level Vega-Lite facet. */
  facetLayout?: FacetLayoutPlan | null;
}

/**
 * Compile a (raw, saved) Vega-Lite spec into a full Vega spec with the theme (chart-plan's
 * prepareVegaLite → vega-lite compile → finishCompiledVega). Explicit spec sizing wins.
 */
export function compileVegaLite(
  spec: Record<string, unknown>,
  mode: ChartTheme,
  options?: CompileVegaLiteOptions,
): VegaSpec {
  const { prepared, config } = prepareVegaLite(spec, mode, options);
  return finishCompiledVega(compile(prepared as unknown as TopLevelSpec, { config: config as never }).spec, options);
}

/** Parse a compiled Vega spec and build a View with the query result bound as 'main'. */
export function createVegaView(
  vegaSpec: VegaSpec,
  rows: Record<string, unknown>[],
  opts: VegaViewOptions,
): View {
  const runtime = parse(vegaSpec, undefined, { ast: true });
  const view = new View(runtime, {
    expr: expressionInterpreter,
    loader: NO_EXTERNAL_LOADER as never,
    renderer: opts.renderer,
    hover: opts.renderer !== 'none',
  });
  bindRows(view, vegaSpec, rows);
  return resizeVegaView(view, opts);
}

/** Headless render: the server/preview/export/image-attachment path. */
export async function renderVegaLiteToSvg(
  spec: Record<string, unknown>,
  rows: Record<string, unknown>[],
  mode: ChartTheme,
  size?: { width?: number; height?: number },
): Promise<string> {
  const width = size?.width ?? 640;
  const height = size?.height ?? 400;
  const legendPlan = computeLegendPlan(spec, rows, width);
  const facetLayout = computeFacetLayoutPlan(spec, rows, width, height);
  const view = createVegaView(compileVegaLite(spec, mode, { legendPlan, facetLayout }), rows, {
    renderer: 'none',
    ...size,
    facetLayout,
  });
  try {
    await view.runAsync();
    return await view.toSVG();
  } finally {
    view.finalize();
  }
}

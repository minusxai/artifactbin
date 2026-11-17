/**
 * The single Vega render pipeline: prepare → theme config → vega-lite compile
 * → vega parse (ast) → View (CSP-safe expression interpreter) → named data injection.
 *
 * Used by the browser component (<VegaChart>, renderer 'svg' into a container) and
 * headlessly (renderer 'none' → toSVG) for server previews, exports, and the
 * chart→LLM image pipeline. One pipeline, no divergence.
 *
 * Security: specs are parsed with {ast: true} and evaluated with
 * vega-interpreter — no generated JavaScript functions, CSP-safe everywhere.
 * External data can't reach this layer (the validator rejects data.url/values, and the
 * only datasets bound are the query result under the reserved name plus the boundary
 * assets a recipe — or a detached spec — declares. Every one goes through the geo
 * registry, which throws on any id outside its allowlist, so a spec-supplied URL is
 * never fetched however the envelope was authored).
 * TODO: tighten the Vega event config (deny window/timer/selector sources).
 * The shipped interactions — legend toggle, map pan/zoom — use only view-scoped
 * pointer/wheel events, so nothing depends on those sources today.
 */
import { compile } from 'vega-lite';
import type { TopLevelSpec } from 'vega-lite';
import { parse, View } from 'vega';
import type { Spec as VegaSpec } from 'vega';
import { expressionInterpreter } from 'vega-interpreter';
import { getVegaParserConfig } from './theme';
import { createVegaTooltipHandler } from './vega-tooltip-handler';
import {
  bindRows, computeLegendPlan, finishCompiledVega, NO_EXTERNAL_LOADER, planChart, prepareVegaLite,
  resizeVegaView, type ChartEngines, type ChartTheme, type CompileVegaLiteOptions, type ResolvedChartSpec,
} from './chart-plan';
import { getTemplate, materializeRecipe } from './viz-templates';
import type { VizResultColumn } from './types';
import { loadGeoFeatures } from './geo-assets';
import { computeFacetLayoutPlan, type FacetLayoutPlan } from './facet-layout';
import type { VizEnvelope } from '@/lib/validation';

// Facet layout math lives in ./facet-layout (pure, engine-free); re-exported here
// because this pipeline is where every view build consumes the plan.
export { computeFacetLayoutPlan, type FacetLayoutPlan };
export {
  computeLegendPlan, computeXLabelAngle, injectSingleSeriesLegend, legendPlanKey, resizeVegaView, setMainData,
} from './chart-plan';

/** The npm grammar engines, for chart-plan's engine-free builders. */
export const SERVER_ENGINES: ChartEngines = {
  compile: (spec, options) => compile(spec as TopLevelSpec, options as never),
  parse: (spec, config, options) => parse(spec, config as never, options),
  View: View as unknown as ChartEngines['View'],
  expressionInterpreter,
};

type ResolvedEnvelopeSpec =
  | { ok: true; spec: Record<string, unknown>; engine: 'vega-lite' | 'vega'; assets?: Record<string, string> }
  | { ok: false; error: string };

/**
 * Resolve an envelope's renderable spec + grammar engine: native sources return their
 * spec, recipe sources materialize from the shipped registry (render-time, never stored).
 * A recipe's declared boundary/lookup `assets` ride along for the injection step.
 */
export function resolveEnvelopeSpec(envelope: VizEnvelope, columns?: VizResultColumn[]): ResolvedEnvelopeSpec {
  const source = envelope.source as unknown as Record<string, unknown>;
  if (source.kind === 'recipe') {
    // A LIVE workspace-recipe reference carries a computed `spec` + `grammar`,
    // attached by materialization (the file loader on the server, the client
    // catalog for staged edits). An unresolved reference has neither — the
    // caller (QuestionVisualization) degrades to a table before reaching here.
    if (typeof source.recipe === 'string' && !getTemplate(source.recipe)) {
      if (source.spec && typeof source.spec === 'object') {
        return {
          ok: true,
          spec: source.spec as Record<string, unknown>,
          engine: source.grammar === 'vega@6' ? 'vega' : 'vega-lite',
        };
      }
      return { ok: false, error: `viz recipe "${source.recipe}" is not resolved${source.unresolved ? ` (${source.unresolved})` : ''}` };
    }
    return materializeRecipe(source as unknown as { recipe: string; bindings: Record<string, string> }, columns);
  }
  // Detached native-Vega spec: render as-is on the vega engine, carrying
  // any named boundary/lookup datasets for injection (geo maps keep working post-detach).
  if (source.kind === 'vega') {
    const assets = source.assets as Record<string, string> | null | undefined;
    return {
      ok: true,
      spec: source.spec as Record<string, unknown>,
      engine: 'vega',
      ...(assets && Object.keys(assets).length > 0 ? { assets } : {}),
    };
  }
  return { ok: true, spec: (source as { spec: Record<string, unknown> }).spec, engine: 'vega-lite' };
}

/**
 * Inject a recipe's named boundary/lookup datasets into a built view.
 * Each `{localName: assetId}` is resolved from the geo registry and bound under its
 * local name alongside `main` — the only path secondary geometry reaches the renderer
 * (there is no network fetch inside the vega runtime). Features are shallow-cloned per
 * view: vega tags each bound tuple with Symbol(vega_id), and the registry caches and
 * shares the feature objects across every chart. `load` is injectable for tests.
 */
export async function injectNamedAssets(
  view: View,
  assets: Record<string, string> | undefined,
  load: (assetId: string) => Promise<import('geojson').Feature[]> = loadGeoFeatures,
): Promise<void> {
  if (!assets) return;
  await Promise.all(Object.entries(assets).map(async ([name, assetId]) => {
    const features = await load(assetId);
    view.data(name, features.map(f => ({ ...f })));
  }));
}

/**
 * Turn a resolved spec into the parsed-vega inputs: VL specs compile (theme embedded
 * in the VL config); native Vega specs go straight to parse with the themed parser
 * config. One divergence point, both tiers themed from the same tokens.
 */
export function toVegaSpec(
  resolved: { spec: Record<string, unknown>; engine: 'vega-lite' | 'vega' },
  mode: ChartTheme,
  options?: CompileVegaLiteOptions,
): { vegaSpec: VegaSpec; parserConfig?: Record<string, unknown> } {
  if (resolved.engine === 'vega') {
    const parserConfig = getVegaParserConfig(mode, options?.categoryRange);
    return { vegaSpec: resolved.spec as unknown as VegaSpec, parserConfig };
  }
  return { vegaSpec: compileVegaLite(resolved.spec, mode, options) };
}

/** The chart plan with the server's engines (chart-plan's planChart). */
export function planVega(
  resolved: ResolvedChartSpec,
  rows: Record<string, unknown>[],
  size: { width: number; height: number },
  mode: ChartTheme,
  categoryRange: string[] | null,
) {
  return planChart(SERVER_ENGINES, resolved, rows, size, mode, categoryRange);
}

interface VegaViewOptions {
  renderer: 'svg' | 'canvas' | 'none';
  /** DOM container (browser only). */
  container?: HTMLElement;
  width?: number;
  height?: number;
  /** Container-bounded child sizing for a top-level Vega-Lite facet. */
  facetLayout?: FacetLayoutPlan | null;
  /** Install the styled HTML tooltip handler (browser only; styled in `tooltip-styles.ts`). */
  tooltipTheme?: 'light' | 'dark';
  /** Vega parser config — used by the native-vega engine (VL bakes theme at compile). */
  parserConfig?: Record<string, unknown>;
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
  const runtime = parse(vegaSpec, (opts.parserConfig ?? undefined) as never, { ast: true });
  const view = new View(runtime, {
    expr: expressionInterpreter,
    loader: NO_EXTERNAL_LOADER as never,
    renderer: opts.renderer,
    hover: opts.renderer !== 'none',
    ...(opts.container ? { container: opts.container } : {}),
    ...(opts.container && opts.tooltipTheme
      ? { tooltip: createVegaTooltipHandler(opts.container, opts.tooltipTheme) }
      : {}),
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

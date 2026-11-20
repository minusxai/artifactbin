/**
 * THE CHART PLAN, engine-free: every decision the render pipeline makes about a spec before and
 * after the grammar engines run, with the engines passed in (`ChartEngines`). The server
 * (render-vega.ts, the npm packages) and the hosted <af-chart> (lib/html-components/chart.ts, the
 * page's `@afbin/vega` and `@afbin/vega-lite`) both build views through `createChartView`, so a
 * chart drawn on a page and the query image of the same chart cannot diverge. Nothing here imports
 * vega at runtime: only types, so the component bundles none of it.
 *
 * Render-time additions, never written back into a spec: Vega-Lite single and layered views get
 * `width/height: "container"` and fit autosize unless the spec sizes itself; a colourless unit
 * chart gets a one-entry legend named after its measure; a single view with a discrete colour
 * field gets click-to-highlight legend entries (the reserved `mx_legend_sel` param) unless it
 * declares params or opacity; rect marks on discrete axes get flush bands; redundant category
 * legend titles are dropped; wide legends wrap into at most three rows ("+N more"); crowded
 * discrete x labels slant; top-level facets are sized to the container. Theme values come from
 * `ChartTokens` and lose to anything the spec's own `config` sets. Label widths are estimated at
 * a monospace advance, so with a proportional body font legends wrap and labels slant slightly
 * early rather than overflow.
 *
 * Security: specs are parsed with {ast: true} and evaluated with the expression interpreter (no
 * generated functions), and every view gets `NO_EXTERNAL_LOADER`, which refuses every data or
 * image load: rows reach a chart only by binding.
 */
import type { Spec as VegaSpec, View } from 'vega';
import { prepareVegaLiteSpec } from './prepare';
import { annotationSplit } from './annotation-layers';
import { getVegaLiteConfig, getVegaParserConfig, getSurfaceColor, type ChartTokens } from './theme';
import { computeFacetLayoutPlan, record, type FacetLayoutPlan } from './facet-layout';
import { VIZ_DATASET_MAIN } from './types';

/** A mode name (the house tokens) or a page's resolved tokens. */
export type ChartTheme = 'light' | 'dark' | ChartTokens;

/** The grammar engines a caller supplies: the npm packages on the server, the hosted modules on a page. */
export interface ChartEngines {
  compile(spec: unknown, options: { config: Record<string, unknown> }): { spec: VegaSpec };
  parse(spec: VegaSpec, config: unknown, options: { ast: true }): unknown;
  View: new (runtime: never, options: Record<string, unknown>) => View;
  expressionInterpreter: unknown;
}

/**
 * Single-series legend (ECharts parity, matches the radar behavior): a colorless
 * unit chart with a field-bearing y gets a constant color datum named after the
 * measure (its title if set, else the field name) — which renders as a one-entry
 * legend. Render-time only; any author color encoding wins untouched — and so
 * does an explicit mark color/fill: an encoding BEATS the mark in Vega-Lite, so
 * injecting one over `mark.color` would silently repaint the author's choice
 * with the theme palette.
 */
export function injectSingleSeriesLegend(prepared: Record<string, unknown>): void {
  const encoding = prepared.encoding as Record<string, Record<string, unknown> | undefined> | undefined;
  if (!encoding || encoding.color != null) return;
  const mark = prepared.mark as Record<string, unknown> | string | undefined;
  if (typeof mark === 'object' && mark != null && (mark.color != null || mark.fill != null)) return;
  const y = encoding.y;
  if (!y || typeof y !== 'object' || typeof y.field !== 'string') return;
  const label = typeof y.title === 'string' ? y.title : y.field;
  encoding.color = { datum: label };
}

/**
 * Interactive-legend platform default (ECharts parity): clicking a legend entry
 * highlights that series (shift-click for multi-select, click elsewhere to clear).
 * Injected at render time only — never persisted — and only when it's safely additive:
 * a single-view spec with a discrete color field, no author params, no author opacity.
 * Uses the reserved `mx` signal namespace.
 */
function injectLegendToggle(prepared: Record<string, unknown>): void {
  if ('params' in prepared) return;
  // Composite marks (boxplot/errorbar/errorband): VL silently DROPS selection params
  // on them but still compiles the opacity condition, leaving a dangling reference —
  // the runtime throws `Unrecognized signal name: "mx_legend_sel"`.
  const mark = prepared.mark;
  const markType = typeof mark === 'string' ? mark : (mark as { type?: string } | undefined)?.type;
  if (markType === 'boxplot' || markType === 'errorbar' || markType === 'errorband') return;
  const encoding = prepared.encoding as Record<string, Record<string, unknown>> | undefined;
  const color = encoding?.color;
  if (!encoding || !color || typeof color.field !== 'string' || 'opacity' in encoding) return;
  if (color.type != null && color.type !== 'nominal' && color.type !== 'ordinal') return;
  prepared.params = [{
    name: 'mx_legend_sel',
    select: { type: 'point', fields: [color.field] },
    bind: 'legend',
  }];
  encoding.opacity = {
    condition: { param: 'mx_legend_sel', value: 1 },
    value: 0.25,
  };
}

/**
 * House heatmap cell layout: rect-mark unit specs get FLUSH bands (padding 0) on
 * their discrete x/y — the visible gap between cells is the theme's constant-pixel
 * surface-colour stroke, NOT band padding, which scales with cell size and looks
 * cavernous on small cross-tabs. Any author-set scale padding on a channel opts out.
 */
function injectHeatmapCellLayout(prepared: Record<string, unknown>): void {
  const mark = prepared.mark;
  const markType = typeof mark === 'string' ? mark : (mark as { type?: string } | undefined)?.type;
  if (markType !== 'rect') return;
  const encoding = prepared.encoding as Record<string, unknown> | undefined;
  if (!encoding) return;
  for (const channel of ['x', 'y']) {
    const def = encoding[channel];
    if (!def || typeof def !== 'object' || Array.isArray(def)) continue;
    const d = def as Record<string, unknown>;
    if (d.type !== 'nominal' && d.type !== 'ordinal') continue;
    const scale = (d.scale ?? {}) as Record<string, unknown>;
    if ('paddingInner' in scale || 'paddingOuter' in scale || 'padding' in scale) continue;
    d.scale = { ...scale, paddingInner: 0, paddingOuter: 0 };
  }
}

/**
 * Legend wrap planning. The house legend is one centered row of entries;
 * anchored middle, a too-wide row clips on BOTH edges in a narrow
 * container (dashboard tile) and trailing entries disappear entirely.
 *
 * The column count is decided HERE in plain JS, not by a Vega signal: signal
 * expressions on `columns` are evaluated against an unsettled width and the
 * legend layout never re-flows (probed headless: the width signal read 232
 * regardless of the real container). The renderer knows the true container
 * width, the entry labels come from the data, and the house font is mono, so
 * label widths are exact — the resulting CONSTANT is baked in before parse, so
 * the fit-autosize pass sees the final legend height (no post-layout clipping).
 */
// JetBrains Mono advance width is 0.6em at the 11px legend-label size.
const LEGEND_LABEL_CHAR_PX = 6.6;
const LEGEND_LABEL_LIMIT = 220; // theme labelLimit — vega truncates past this
const LEGEND_ENTRY_CHROME_PX = 36; // symbol + label offset + column padding
const LEGEND_AXIS_GUTTER_PX = 0; // y-axis labels + title the legend row can't use
const LEGEND_PADDING_GUTTER_PX = 16; // axis-less charts (pie): view padding only
const LEGEND_MAX_ROWS = 3; // beyond this the legend eats the chart — truncate instead

export interface LegendWrapPlan {
  /** Grid column count baked onto the legend. */
  columns: number;
  /** Explicit entry list when truncated to LEGEND_MAX_ROWS (display order). */
  values?: string[];
  /** Hidden-entry count behind `values` — shown as a "+N more" list entry. */
  moreCount?: number;
}

/**
 * Omit only redundant, implicit category headings. Quantitative legends need
 * their measure/units; explicit legend titles and channel aliases always survive.
 */
const LEGEND_CHANNELS = ['color', 'fill', 'stroke', 'opacity', 'shape', 'size', 'strokeDash'] as const;

function suppressLegendTitles(spec: Record<string, unknown>): void {
  const encoding = spec.encoding as Record<string, unknown> | undefined;
  for (const channel of LEGEND_CHANNELS) {
    const def = encoding?.[channel];
    if (!def || typeof def !== 'object' || Array.isArray(def)) continue;
    const d = def as Record<string, unknown>;
    if (typeof d.field !== 'string') continue;
    const legend = d.legend as Record<string, unknown> | null | undefined;
    if (legend === null || legend?.title !== undefined || d.title !== undefined) continue;
    if (d.type !== 'nominal' && d.type !== 'ordinal') continue;
    d.legend = { ...(legend ?? {}), title: null };
  }
  const layers = spec.layer;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      if (layer != null && typeof layer === 'object' && !Array.isArray(layer)) {
        suppressLegendTitles(layer as Record<string, unknown>);
      }
    }
  }
}

/** Whether any (sub)view positions on y — i.e. a left axis gutter exists. */
function hasYField(spec: Record<string, unknown>): boolean {
  const y = (spec.encoding as Record<string, Record<string, unknown>> | undefined)?.y;
  if (y && typeof y === 'object' && 'field' in y) return true;
  const layers = spec.layer;
  if (Array.isArray(layers) && layers.some(l =>
    l != null && typeof l === 'object' && !Array.isArray(l) && hasYField(l as Record<string, unknown>))) {
    return true;
  }
  const child = record(spec.spec);
  return child ? hasYField(child) : false;
}

/** The color-channel def of a unit spec, or the first color among layers. */
function findColorDef(spec: Record<string, unknown>): Record<string, unknown> | null {
  const own = (spec.encoding as Record<string, unknown> | undefined)?.color;
  if (own && typeof own === 'object' && !Array.isArray(own)) return own as Record<string, unknown>;
  const layers = spec.layer;
  if (Array.isArray(layers)) {
    for (const layer of layers) {
      if (layer && typeof layer === 'object' && !Array.isArray(layer)) {
        const found = findColorDef(layer as Record<string, unknown>);
        if (found) return found;
      }
    }
  }
  const child = record(spec.spec);
  if (child) return findColorDef(child);
  return null;
}

/**
 * Decide the top legend's wrap for `containerWidth`, or null to leave Vega's
 * single-row default (fits, or not ours to touch: authored columns / non-top
 * orient / gradient / no discrete color field). When even the wrapped grid
 * would exceed LEGEND_MAX_ROWS, the plan truncates: the first columns×rows
 * entries (display order) plus a "(+N more)" title suffix — the CHART keeps
 * every series; only the legend elides.
 */
export function computeLegendPlan(
  spec: Record<string, unknown>,
  rows: Record<string, unknown>[],
  containerWidth: number,
): LegendWrapPlan | null {
  const color = findColorDef(spec);
  if (!color || typeof color.field !== 'string') return null;
  if (color.type === 'quantitative' || color.type === 'temporal') return null; // gradient legend
  const legend = color.legend as Record<string, unknown> | null | undefined;
  if (legend === null) return null; // legend disabled
  if (legend && ('columns' in legend || ('orient' in legend && legend.orient !== 'top'))) return null;

  // Entry labels: the color field's distinct values — except under a fold
  // (multi-Y), where the key never appears in the raw rows and the labels are
  // the folded column names from the transform itself.
  const field = color.field;
  let labels: string[] | null = null;
  const transforms = spec.transform;
  if (Array.isArray(transforms)) {
    for (const t of transforms) {
      const fold = (t as Record<string, unknown>)?.fold;
      const as = (t as Record<string, unknown>)?.as;
      if (Array.isArray(fold) && Array.isArray(as) && as[0] === field) {
        labels = fold.map(String);
        break;
      }
    }
  }
  if (!labels) {
    const seen = new Set<string>();
    for (const row of rows) {
      const v = row[field];
      if (v != null) seen.add(String(v));
    }
    labels = [...seen];
  }
  if (labels.length < 2) return null;

  const labelPx = (text: string, charPx: number, limit: number) =>
    Math.min(Math.ceil(text.length * charPx), limit);
  const entryWidths = labels.map(l => labelPx(l, LEGEND_LABEL_CHAR_PX, LEGEND_LABEL_LIMIT) + LEGEND_ENTRY_CHROME_PX);
  const gutter = hasYField(spec) ? LEGEND_AXIS_GUTTER_PX : LEGEND_PADDING_GUTTER_PX;
  const available = Math.max(containerWidth - gutter, 60);

  const singleRow = entryWidths.reduce((a, b) => a + b, 0);
  if (singleRow <= available) return null;
  // Each column is as wide as its widest entry (plan with the max so the
  // estimate can only over-wrap, never overflow).
  const maxEntry = Math.max(...entryWidths);
  const columns = Math.max(1, Math.floor(available / maxEntry));
  if (Math.ceil(labels.length / columns) <= LEGEND_MAX_ROWS) return { columns };
  // Truncate in display order (Vega's default ascending domain sort). The
  // "+N more" sentinel takes the grid's last slot, so it costs one real entry.
  const visible = columns * LEGEND_MAX_ROWS - 1;
  const sorted = [...labels].sort();
  return { columns, values: sorted.slice(0, visible), moreCount: labels.length - visible };
}

/** Bake a wrap plan onto discrete top legends of a COMPILED spec. */
function injectLegendPlan(vegaSpec: Record<string, unknown>, plan: LegendWrapPlan): void {
  const legends = vegaSpec.legends as Record<string, unknown>[] | undefined;
  if (!Array.isArray(legends)) return;
  const scales = (vegaSpec.scales ?? []) as { name?: string; type?: string }[];
  const DISCRETE = ['ordinal', 'band', 'point'];
  for (const legend of legends) {
    if ('columns' in legend) continue; // author opt-out
    if ('orient' in legend && legend.orient !== 'top') continue;
    const scaleName = (['fill', 'stroke', 'shape', 'size', 'opacity'] as const)
      .map(ch => legend[ch]).find(v => typeof v === 'string');
    const scale = scales.find(s => s.name === scaleName);
    if (!scale || !DISCRETE.includes(scale.type ?? '')) continue;
    legend.columns = plan.columns;
    if (plan.values && plan.moreCount) {
      // The "+N more" indicator is a LIST ENTRY: a sentinel value appended to
      // the explicit entry list. It isn't in the scale domain, so its symbol is
      // hidden (opacity 0) and its label muted — a pure text row in the grid.
      const sentinel = `+${plan.moreCount} more`;
      legend.values = [...plan.values, sentinel];
      const isSentinel = `datum.value === '${sentinel}'`;
      legend.encode = {
        symbols: { update: { opacity: [{ test: isSentinel, value: 0 }, { value: 1 }] } },
        labels: { update: { opacity: [{ test: isSentinel, value: 0.55 }, { value: 1 }] } },
        ...(legend.encode as object | undefined ?? {}),
      };
    } else if (plan.values) {
      legend.values = plan.values;
    }
  }
}

/**
 * Adaptive x-axis label angle (house default). Vega-Lite's discrete-axis default
 * is labelAngle -90 — every category chart rendered vertical labels. Like the
 * legend wrap, the angle is planned HERE in plain JS from the actual labels and
 * the true container width (mono font → label widths are exact), then baked in
 * before compile:
 *   0 (horizontal) when the widest label fits its band step,
 *   -45 (slanted) when crowded but the steps still give slant room,
 *   null for ultra-dense axes (≲16px steps, e.g. heatmap week columns) — leave
 *   Vega-Lite's vertical default, the only orientation that survives that density.
 * Authored settings win: an explicit x-axis labelAngle (or axis: null) → null.
 */
const XLABEL_CHAR_PX = 6.6;     // JetBrains Mono advance width at the 11px label size
const XLABEL_PADDING_PX = 10;   // breathing room between neighboring horizontal labels
const XLABEL_MIN_SLANT_STEP_PX = 16; // below this even -45 labels collide
const XLABEL_Y_GUTTER_PX = 55;  // y-axis labels + title the plot area can't use
const XLABEL_SCAN_CAP = 400;    // distinct-label scan bound (dense axes exit via null anyway)

export function computeXLabelAngle(
  spec: Record<string, unknown>,
  rows: Record<string, unknown>[],
  containerWidth: number,
): number | null {
  const unit = annotationSplit(spec)?.unit ?? null;
  if (!unit) return null; // composed spec — not ours to touch
  const x = (unit.encoding as Record<string, Record<string, unknown>> | undefined)?.x;
  if (!x || typeof x.field !== 'string') return null;
  if (x.type !== 'nominal' && x.type !== 'ordinal') return null; // continuous axes are horizontal already
  if (x.axis === null) return null; // axis disabled by the author
  const axis = x.axis as Record<string, unknown> | undefined;
  if (axis && 'labelAngle' in axis) return null; // authored angle wins

  const seen = new Set<string>();
  for (const row of rows) {
    const v = row[x.field];
    if (v != null) seen.add(String(v));
    if (seen.size > XLABEL_SCAN_CAP) break;
  }
  if (seen.size === 0) return null;

  const available = Math.max(containerWidth - (hasYField(unit) ? XLABEL_Y_GUTTER_PX : 0), 60);
  const step = available / seen.size;
  const maxLabelPx = Math.max(...[...seen].map(l => l.length)) * XLABEL_CHAR_PX;
  if (maxLabelPx + XLABEL_PADDING_PX <= step) return 0;
  if (step >= XLABEL_MIN_SLANT_STEP_PX) return -45;
  return null;
}

/** Bake a planned x label angle onto the (unit or annotated-base) x encoding. */
function injectXLabelAngle(prepared: Record<string, unknown>, angle: number): void {
  const unit = annotationSplit(prepared)?.unit ?? null;
  const x = (unit?.encoding as Record<string, Record<string, unknown>> | undefined)?.x;
  if (!x || x.axis === null) return;
  const axis = (x.axis ?? {}) as Record<string, unknown>;
  if ('labelAngle' in axis) return;
  x.axis = { ...axis, labelAngle: angle };
}

export interface CompileVegaLiteOptions {
  /** Planned legend wrap (computeLegendPlan) — null/undefined = single row. */
  legendPlan?: LegendWrapPlan | null;
  /** Planned x label angle (computeXLabelAngle) — null/undefined = VL defaults. */
  xLabelAngle?: number | null;
  /** Initial container-bounded dimensions for top-level facet child plots. */
  facetLayout?: FacetLayoutPlan | null;
  /**
   * Palette override — the surrounding design theme's `--chart-1..5` tokens
   * (lib/viz/chart-tokens.ts). null/undefined = the house palette. Applied to both engines:
   * categorical and continuous defaults are derived in theme.ts for both engines.
   */
  categoryRange?: string[] | null;
}

export function prepareVegaLite(
  spec: Record<string, unknown>,
  mode: ChartTheme,
  options?: CompileVegaLiteOptions,
): { prepared: Record<string, unknown>; config: Record<string, unknown> } {
  // Ownership boundary: specs arrive from state the caller still owns, and vega-lite/vega
  // mutate their inputs (normalization, Symbol(vega_id) tagging). Never hand them
  // shared state — deep-clone here (specs are small).
  const prepared = prepareVegaLiteSpec(JSON.parse(JSON.stringify(spec)) as Record<string, unknown>);
  if (options?.xLabelAngle != null) injectXLabelAngle(prepared, options.xLabelAngle);
  // A discrete x/y inside a facet normally compiles child_width/child_height as
  // STEP-DERIVED signals. Runtime signal writes are then overwritten by the next
  // dataflow pulse. Seed missing child dimensions before compile so both discrete
  // and continuous facets produce directly resizable child signals. Authored
  // dimensions remain the opt-out represented by an absent plan dimension.
  if (options?.facetLayout && 'facet' in prepared) {
    const child = record(prepared.spec);
    if (child) {
      if (options.facetLayout.childWidth != null
        && !Object.prototype.hasOwnProperty.call(child, 'width')) {
        child.width = options.facetLayout.childWidth;
      }
      if (options.facetLayout.childHeight != null
        && !Object.prototype.hasOwnProperty.call(child, 'height')) {
        child.height = options.facetLayout.childHeight;
      }
    }
  }
  // Responsive container fill (`width/height: 'container'` is only valid for
  // single/layer specs). Without an explicit width, VL STEP-SIZES discrete axes
  // (band-step × category count) — a 3-category bar renders ~60px wide instead of
  // filling the card. Container sizing flips the scale range to [0, container].
  // An explicit spec width/height/autosize is the author's opt-out.
  const composed = ['hconcat', 'vconcat', 'concat', 'repeat', 'facet'].some(k => k in prepared);
  if (!composed) {
    if (!('width' in prepared)) prepared.width = 'container';
    if (!('height' in prepared)) prepared.height = 'container';
    if (!('autosize' in prepared)) prepared.autosize = { type: 'fit', contains: 'padding' };
  }
  // Legend defaults only for true single-view specs — in composed/layered specs param
  // placement differs per view, so authors declare interactions themselves. Exception:
  // an ANNOTATED unit (base chart + reference-line layers) applies them to its base,
  // so adding a reference line doesn't cost the single-series legend or legend toggle.
  if (!composed && !('layer' in prepared)) {
    injectSingleSeriesLegend(prepared);
    injectLegendToggle(prepared);
    injectHeatmapCellLayout(prepared);
  } else if (!composed) {
    const split = annotationSplit(prepared);
    if (split && split.annotations.length > 0) {
      injectSingleSeriesLegend(split.unit);
      injectLegendToggle(split.unit);
      injectHeatmapCellLayout(split.unit);
      // Reference-line badge BACKING plates: the saved spec tags them with the
      // 'mx-annotation-plate' style and no fill (mode-free on disk); the renderer
      // resolves the opaque surface color here. VL bakes mark fills at compile, so
      // a config.style entry can't do this.
      for (const layer of split.annotations) {
        const mark = layer.mark as Record<string, unknown> | undefined;
        if (mark && typeof mark === 'object' && mark.style === 'mx-annotation-plate' && mark.fill == null) {
          mark.fill = getSurfaceColor(mode);
        }
      }
    }
  }
  // Keep meaningful measure/units and authored titles; omit redundant category headings.
  if (!composed) suppressLegendTitles(prepared);
  return { prepared, config: getVegaLiteConfig(mode, options?.categoryRange) as Record<string, unknown> };
}

/** After vega-lite's compile: the centred top legend and the planned legend wrap, baked in. */
export function finishCompiledVega(vegaSpec: VegaSpec, options?: CompileVegaLiteOptions): VegaSpec {
  // Center top legends within the chart width (a Vega-level legend layout — VL's
  // config surface doesn't expose it, so it's merged into the compiled config).
  const cfg = ((vegaSpec as unknown as Record<string, unknown>).config ??= {}) as Record<string, unknown>;
  const legendCfg = (cfg.legend ??= {}) as Record<string, unknown>;
  legendCfg.layout = { top: { anchor: 'middle' }, ...(legendCfg.layout as object | undefined ?? {}) };
  if (options?.legendPlan != null) {
    injectLegendPlan(vegaSpec as unknown as Record<string, unknown>, options.legendPlan);
  }
  return vegaSpec;
}



const setSignalIfPresent = (view: View, name: string, value: number): void => {
  try {
    view.signal(name, value);
  } catch {
    // The plan is derived from the authored VL spec, but a future compiler may
    // rename or omit the child signal. Leave that dimension at its compiled value.
  }
};

/**
 * Apply the correct responsive signals for the compiled view shape. Unit/layer
 * charts use Vega's root dimensions; top-level facets use child dimensions and
 * must not also receive a root size (that root becomes extra overflowing area).
 */
export function resizeVegaView(
  view: View,
  size: Pick<ChartViewOptions, 'width' | 'height' | 'facetLayout'>,
): View {
  if (size.facetLayout) {
    if (size.facetLayout.childWidth != null) {
      setSignalIfPresent(view, 'child_width', size.facetLayout.childWidth);
    }
    if (size.facetLayout.childHeight != null) {
      setSignalIfPresent(view, 'child_height', size.facetLayout.childHeight);
    }
    return view;
  }
  if (size.width != null) view.width(size.width);
  if (size.height != null) view.height(size.height);
  return view;
}


/** Fingerprint of the compile-time legend-wrap and x-label-angle plans: a resize that changes it must rebuild the view. */
export function legendPlanKey(vl: Record<string, unknown> | null, rows: Record<string, unknown>[], width: number): string {
  return JSON.stringify({
    legend: vl ? computeLegendPlan(vl, rows, width) ?? null : null,
    xAngle: vl ? computeXLabelAngle(vl, rows, width) : null,
  });
}

/** A renderable spec and its grammar. */
export interface ResolvedChartSpec { spec: Record<string, unknown>; engine: 'vega-lite' | 'vega' }

/**
 * The legend-wrap, x-label-angle and facet decisions for a slot `size`, then the Vega spec
 * compiled with them. `legendKey` fingerprints what a resize must rebuild for.
 */
export function planChart(
  engines: Pick<ChartEngines, 'compile'>,
  resolved: ResolvedChartSpec,
  rows: Record<string, unknown>[],
  size: { width: number; height: number },
  theme: ChartTheme,
  categoryRange: string[] | null = null,
) {
  const vl = resolved.engine === 'vega-lite' ? resolved.spec : null;
  if (!vl) {
    return { vl, vegaSpec: resolved.spec as unknown as VegaSpec, parserConfig: getVegaParserConfig(theme, categoryRange),
      facetLayout: null, legendKey: legendPlanKey(null, rows, size.width) };
  }
  const legendPlan = computeLegendPlan(vl, rows, size.width);
  const xLabelAngle = computeXLabelAngle(vl, rows, size.width);
  const facetLayout = computeFacetLayoutPlan(vl, rows, size.width, size.height);
  const options = { legendPlan, xLabelAngle, facetLayout, categoryRange };
  const { prepared, config } = prepareVegaLite(vl, theme, options);
  const vegaSpec = finishCompiledVega(engines.compile(prepared, { config }).spec, options);
  return { vl, vegaSpec, parserConfig: undefined as Record<string, unknown> | undefined, facetLayout,
    legendKey: legendPlanKey(vl, rows, size.width) };
}

const refused = () => Promise.reject(new Error('external data is refused: a chart draws only the rows it is given'));
/**
 * Every view's loader: no data URL, file or image is ever fetched. Mark links (`href`) still
 * open when they are http(s) or page-relative.
 */
export const NO_EXTERNAL_LOADER = {
  options: {}, fileAccess: false,
  load: refused, http: refused, file: refused,
  sanitize: (uri: unknown, options?: { context?: string }) =>
    options?.context === 'href' && typeof uri === 'string' && (/^https?:/i.test(uri) || !/^[a-z][a-z0-9+.-]*:/i.test(uri))
      ? Promise.resolve({ href: uri }) : refused(),
};

/** The datasets a compiled Vega spec declares by name. */
export const declaredDatasets = (vegaSpec: VegaSpec): string[] =>
  ((vegaSpec as { data?: { name?: unknown }[] }).data ?? []).map(d => d.name).filter((n): n is string => typeof n === 'string');

/** Bind rows under `name` when the spec declares it (a spec carrying its own values has no `main`). */
export function bindRows(view: View, vegaSpec: VegaSpec, rows: Record<string, unknown>[], name = VIZ_DATASET_MAIN): boolean {
  if (!declaredDatasets(vegaSpec).includes(name)) return false;
  view.data(name, rows.map(r => ({ ...r })));
  return true;
}

export interface ChartViewOptions {
  renderer: 'svg' | 'canvas' | 'none';
  container?: HTMLElement;
  width?: number;
  height?: number;
  facetLayout?: FacetLayoutPlan | null;
  parserConfig?: Record<string, unknown>;
  /** A tooltip handler; omitted, the engine's View default (the hosted View's is themed). */
  tooltip?: unknown;
  /** The dataset rows bind to (default `main`). */
  dataName?: string;
}

/** Parse a compiled Vega spec into a View with the no-external loader and the rows bound. */
export function createChartView(
  engines: Pick<ChartEngines, 'parse' | 'View' | 'expressionInterpreter'>,
  vegaSpec: VegaSpec,
  rows: Record<string, unknown>[],
  opts: ChartViewOptions,
): View {
  const runtime = engines.parse(vegaSpec, opts.parserConfig ?? undefined, { ast: true });
  const view = new engines.View(runtime as never, {
    expr: engines.expressionInterpreter,
    loader: NO_EXTERNAL_LOADER,
    renderer: opts.renderer,
    hover: opts.renderer !== 'none',
    ...(opts.container ? { container: opts.container } : {}),
    ...(opts.tooltip ? { tooltip: opts.tooltip } : {}),
  });
  bindRows(view, vegaSpec, rows, opts.dataName);
  return resizeVegaView(view, opts);
}

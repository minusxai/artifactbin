/**
 * The product's Vega-Lite theme configs.
 *
 * One token source generates the light and dark VL `config` objects: the chart constants
 * in lib/chart/chart-theme.ts (palette + JetBrains Mono), shared with the native-Vega
 * parser config below so the two grammar tiers cannot drift.
 * Passed as external compiler config — spec-internal `config` wins natively.
 */
import type { Config as VegaLiteConfig } from 'vega-lite';
import { COLOR_PALETTE, LIGHT_THEME, DARK_THEME, getChartFontFamily } from '@/lib/chart/chart-theme';

/**
 * The resolved colours and font one chart is drawn with, as concrete sRGB strings (hex or rgb()).
 * The product's own surfaces use the house set (`houseTokens`); a page's `<af-chart>` and the
 * query image resolve the page's design-system tokens into the same shape (`--chart-1..5`,
 * `--foreground`, `--muted-foreground`, `--border`, the surface and `--font-body`). Engine-free:
 * nothing here imports vega, so the hosted component can bundle it.
 */
export interface ChartTokens {
  category: string[];
  foreground: string;
  muted: string;
  subtle: string;
  border: string;
  grid: string;
  surface: string;
  font: string;
}

/** The house tokens for a mode, optionally with another categorical palette. */
export function houseTokens(mode: 'light' | 'dark', palette?: string[] | null): ChartTokens {
  const c = mode === 'light' ? LIGHT_THEME : DARK_THEME;
  return {
    category: palette?.length ? palette : COLOR_PALETTE, foreground: c.fgDefault, muted: c.fgMuted,
    subtle: c.fgSubtle, border: c.borderDefault, grid: c.borderMuted, surface: c.bgSurface,
    font: getChartFontFamily(),
  };
}

/**
 * THE PAGE-TOKEN MAPPING, one for <af-chart> and the query image: a design system's custom
 * properties → chart tokens. `color(name)` answers a property as a concrete sRGB string (the
 * page resolves through its own computed style; the server through lib/viz/css-color), or null
 * when unset, which keeps the house value for `mode`. The surface is `--background`; `subtle`
 * and `grid` are derived toward it from `--muted-foreground` and `--border`. `font` is the
 * family list text is drawn in.
 */
export function tokensFromThemeVariables(
  color: (name: string) => string | null, font: string, mode: 'light' | 'dark',
): ChartTokens {
  const house = houseTokens(mode);
  const surface = color('--background') ?? house.surface;
  const muted = color('--muted-foreground') ?? house.muted;
  const border = color('--border') ?? house.border;
  const category = [1, 2, 3, 4, 5].map(i => color(`--chart-${i}`)).filter((c): c is string => !!c);
  return {
    category: category.length ? category : house.category, foreground: color('--foreground') ?? house.foreground,
    muted, subtle: mixColor(muted, surface, 0.35), border, grid: mixColor(border, surface, 0.45), surface, font,
  };
}

/** A mode name means the house tokens; tokens pass through. */
const resolveTokens = (theme: 'light' | 'dark' | ChartTokens, palette?: string[] | null): ChartTokens =>
  typeof theme === 'string' ? houseTokens(theme, palette) : palette?.length ? { ...theme, category: palette } : theme;

const channels = (color: string): [number, number, number] | null => {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1]!.length === 3 ? [...hex[1]!].map(x => x + x).join('') : hex[1]!;
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(color.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
};
/** `t` of the way from `a` to `b` in sRGB; `b` when either is not hex/rgb(). */
export function mixColor(a: string, b: string, t: number): string {
  const x = channels(a), y = channels(b);
  if (!x || !y) return b;
  return `rgb(${x.map((v, i) => Math.round(v + (y[i]! - v) * t)).join(',')})`;
}

/**
 * The card-surface color per mode. Used by render-time enrichments that need an OPAQUE
 * surface-colored fill (the reference-line badge backing) — VL bakes mark fills at
 * compile, so named style configs can't supply this; the renderer resolves it instead.
 */
export function getSurfaceColor(theme: 'light' | 'dark' | ChartTokens): string {
  return resolveTokens(theme).surface;
}

/** All color scale defaults share the same palette, in both grammar engines.
 * Ordered values use a lightness ramp, not a sequence of unrelated category hues.
 * Explicit spec ranges/schemes still win in Vega's normal config precedence.
 */
function chartRanges(t: ChartTokens) {
  const category = t.category;
  const primary = category[0]!;
  const surface = t.surface;
  const ramp = [mixColor(surface, primary, 0.2), primary];
  return {
    category,
    ordinal: category,
    ramp,
    heatmap: ramp,
    diverging: [category[1] ?? primary, surface, primary],
  };
}

export function getVegaLiteConfig(theme: 'light' | 'dark' | ChartTokens, palette?: string[] | null): VegaLiteConfig {
  const t = resolveTokens(theme, palette);
  const colors = { fgDefault: t.foreground, fgMuted: t.muted, fgSubtle: t.subtle, borderDefault: t.border, borderMuted: t.grid, bgSurface: t.surface };
  return {
    // getChartFontFamily resolves the ACTUAL loaded font family (the document's
    // --font-jetbrains-mono override when one is set, else the shipped stack). Using a
    // literal name makes canvas measureText and SVG rendering fall back to DIFFERENT
    // fonts — vega then under-reserves every label and titles overlap ticks.
    font: t.font,
    // Default number format for quantitative axis/legend/tooltip labels without an
    // explicit format: SI units ('.3~s' → 20k, 1.5M, 431k). Specs override per-encoding.
    numberFormat: '.3~s',
    // The card owns the surface; charts inherit it.
    background: 'transparent',
    range: chartRanges(t),
    axis: {
      labelColor: colors.fgMuted,
      titleColor: colors.fgDefault,
      gridColor: colors.borderMuted,
      domainColor: colors.borderDefault,
      tickColor: colors.borderDefault,
      labelFontSize: 11,
      titleFontSize: 12,
      titleFontWeight: 'normal',
      gridDash: [3, 3],
      // JetBrains Mono runs wider than the fonts VL's default spacing assumes:
      // give titles room from the tick labels and keep thinned labels apart.
      titlePadding: 12,
      labelSeparation: 4,
      // Discrete (band/point) scales don't thin overlapping labels by default —
      // a 100-value ordinal axis (weekly heatmap columns) renders as a smear.
      labelOverlap: true,
    },
    legend: {
      orient: 'top',
      labelColor: colors.fgMuted,
      // An authored legend title would otherwise be vega's black, unreadable in dark mode.
      titleColor: colors.fgDefault,
      labelFontSize: 11,
      labelLimit: 220,
    },
    // Automatic tooltips everywhere: hovering any mark shows its encoded fields
    // (with their titles/formats). A spec-level `tooltip` encoding overrides this
    // with a custom field list; `mark: {tooltip: null}` opts a spec out.
    mark: { color: t.category[0], tooltip: { content: 'encoding' } },
    // Text marks default to BLACK in vega-lite — unreadable in dark mode. Theme them
    // like axis titles; specs/recipes override per-layer where they need contrast.
    text: { color: colors.fgDefault, fontSize: 11 },
    title: {
      color: colors.fgDefault,
      fontSize: 14,
      fontWeight: 'normal',
      anchor: 'start',
    },
    // Facet headers (small multiples) default to black in vega-lite, unreadable in dark mode.
    header: { labelColor: colors.fgDefault, titleColor: colors.fgDefault },
    view: { stroke: 'transparent' },
    // Sensible mark defaults; spec-level mark properties win natively.
    // Small filled dots on every line point (house default). Kept intentionally small so
    // dense time-series stay legible; a spec can opt out with `mark: {point: false}`.
    line: { strokeWidth: 2, point: { filled: true, size: 25 } },
    point: { filled: true, size: 60 },
    bar: { cornerRadiusEnd: 2 },
    // Choropleth / analytic-geo regions: a bare `mark: geoshape` — the
    // background outline layer of every map recipe — draws NO fill (a neutral fill
    // washed the map out on the card and read as a solid block) and a clearly visible
    // inter-region border, so no-data regions read as clean outlines. The choropleth
    // layer's color encoding supplies the fill for regions that DO have data; the
    // border stroke travels to it too.
    geoshape: { fill: 'transparent', stroke: colors.fgSubtle, strokeWidth: 0.75 },
    // House heatmap cells = the GitHub contribution graph: rounded cells with a
    // CONSTANT pixel gap. The gap is a full-band rect stroked in the card surface
    // colour — a relative band gap scales with cell size and looks cavernous on
    // small cross-tabs (2×3 → giant cells → giant gaps).
    rect: { cornerRadius: 5, stroke: colors.bgSurface, strokeWidth: 4 },
    // House pie = responsive donut with rounded, slightly separated sectors (matches
    // the classic ECharts pie). Lives HERE so a bare `mark: arc` — what agents and
    // the UI transform both produce — gets the look; `innerRadius: 0` in a spec
    // opts out to a solid pie.
    arc: {
      innerRadius: { expr: 'min(width,height)/2 * 0.45' },
      cornerRadius: 6,
      padAngle: 0.015,
    },
    // Boxplot sub-marks: whiskers are `rule` marks and VL defaults them (and the
    // outlier points) to BLACK — invisible on the dark card. Mode-aware foregrounds;
    // the median tick uses the strong foreground so it reads against the
    // series-coloured box fill in both modes. Spec-level boxplot config wins natively.
    boxplot: {
      rule: { color: colors.fgMuted, strokeWidth: 1.5 },
      median: { color: colors.fgDefault },
      outliers: { color: colors.fgMuted },
    },
  };
}

/**
 * Parser config for NATIVE Vega specs (the `vega` engine — e.g. radar).
 * Same token source as the VL config so the tiers can't drift. Applied at
 * vega.parse; spec-level properties win natively.
 */
export function getVegaParserConfig(theme: 'light' | 'dark' | ChartTokens, palette?: string[] | null): Record<string, unknown> {
  const t = resolveTokens(theme, palette);
  const colors = { fgDefault: t.foreground, fgMuted: t.muted };
  const font = t.font;
  return {
    background: 'transparent',
    range: chartRanges(t),
    text: { fill: colors.fgDefault, font, fontSize: 11 },
    // Axes too: without these a native spec drew Vega's default black labels and grey rules,
    // unreadable on a dark surface.
    axis: {
      labelColor: colors.fgMuted, labelFont: font, labelFontSize: 11, titleColor: colors.fgDefault,
      titleFont: font, titleFontWeight: 'normal', gridColor: t.grid, domainColor: t.border, tickColor: t.border,
    },
    legend: {
      orient: 'top',
      layout: { top: { anchor: 'middle' } },
      labelColor: colors.fgMuted,
      labelFont: font,
      labelFontSize: 11,
      titleColor: colors.fgDefault,
      titleFont: font,
    },
    title: { color: colors.fgDefault, font, fontSize: 14 },
  };
}

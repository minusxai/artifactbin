/**
 * ADAPTED from minusx lib/validation/atlas-schemas.ts — the subset the ported
 * engine imports, on the same TypeBox foundation. The theme/template enums and
 * the StoryContent field structure are copied from minusx (SQL-era fields —
 * suggestedQuestions, parameterValues, format:'html' legacy — trimmed);
 * prose descriptions are shortened where they referenced minusx-only
 * tooling (Clarify, saved questions).
 */
import { Type, type Static, type TSchema } from 'typebox';
import { STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';

/** Shared helper: a string enum with an optional description. */
const StringEnum = <const T extends readonly string[]>(values: T, description?: string) =>
  Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...(description ? { description } : {}) });

const Nullable = <T extends TSchema>(schema: T) => Type.Optional(Type.Union([schema, Type.Null()]));

const NullableD = <T extends TSchema>(schema: T, description: string) =>
  Type.Optional(Type.Union([schema, Type.Null()], { description }));

/**
 * The six story design themes. The enum lives HERE (this module imports
 * nothing but typebox); the theme registry (`lib/data/story/story-themes.ts`)
 * types its entries against it and a registry test asserts one entry per name.
 */
export const STORY_THEME_NAMES = ['modernist', 'organic', 'industry', 'terminal', 'manuscript', 'pop'] as const;
export type StoryThemeName = (typeof STORY_THEME_NAMES)[number];

/**
 * The story templates — the document's structural GENRE (beat structure +
 * layout grammar), orthogonal to the design theme.
 */
export const STORY_TEMPLATE_NAMES = ['editorial', 'deck', 'scrolly', 'dashboard'] as const;
export type StoryTemplateName = (typeof STORY_TEMPLATE_NAMES)[number];

export const StoryContent = Type.Object({
  description: Nullable(Type.String()),
  story: NullableD(Type.String({ format: 'jsx' }),
    'One self-contained, FLUID RESPONSIVE document rendered as a single scrolling story page. ' +
    'STYLING — the built-in DESIGN SYSTEM: put `data-design="tw"` and the `@container` class on ' +
    'your full-width root wrapper. Every Tailwind v4 utility works (arbitrary values included) — ' +
    'the platform compiles exactly the classes you use at save time. Responsiveness: Tailwind ' +
    'CONTAINER-QUERY variants (`@lg:`, `@2xl:` — NEVER viewport `md:`/`lg:`). COMPONENTS: the ' +
    'body is STATIC JSX — plain HTML content tags styled with Tailwind (`className=`) plus the ' +
    'registered shadcn/ui component set: ' + STORY_UI_COMPONENT_NAME_LIST.join(', ') + '. ' +
    'These are the ONLY Capitalized tags allowed. GRID LAYOUT — ' +
    '<Grid><GridItem x={0} y={0} w={8} h={5}>…</GridItem>…</Grid>: 12 columns × 86px rows.'),
  format: Type.Optional(Type.Union([Type.Literal('jsx'), Type.Null()], { description:
    "'jsx' = the story field holds shadcn JSX source rendered by the story interpreter" })),
  theme: Type.Optional(Nullable(StringEnum(STORY_THEME_NAMES,
    "Design theme for the story (format:'jsx' only) — picks the named design PERSONALITY (fonts, corner " +
    'radius, chart palette, a light AND a dark token set) the story renders with. One of the six built-in ' +
    'themes; omit/null for the neutral default. Components and utility classes are identical across themes ' +
    'and modes, only the tokens change.'))),
  template: Type.Optional(Nullable(StringEnum(STORY_TEMPLATE_NAMES,
    "Story template (format:'jsx' only) — the document's structural genre: 'editorial' (long-read magazine " +
    "feature), 'deck' (slide-section presentation), 'scrolly' (playful scrollytelling), 'dashboard' " +
    '(a Grid of draggable KPI/chart tiles with minimal prose). METADATA ONLY: it records intent and drives ' +
    'the structure YOU write; no automatic CSS or layout is applied.'))),
  colorMode: Type.Optional(Nullable(StringEnum(['light', 'dark'],
    "The AUTHOR'S DEFAULT mode for the story surface. Every theme carries both a light and a dark " +
    "palette; omit/null to open in the theme's own default mode (light when unthemed). Readers can flip " +
    'the rendered mode at view time regardless.'))),
}, { title: 'StoryContent' });
export type StoryContent = Static<typeof StoryContent>;

// ── SQL-era loose types (ADAPTED) ────────────────────────────────────────────
// Stand-ins for the SQL-era shapes the ported modules (story-params/question/
// number) still name. Type-only consumers.
export type ParameterType = 'text' | 'number' | 'date';
// Loose on purpose: the real QuestionContent drags the whole SQL-era schema
// tree (SemanticQuerySpec, CachePolicy, connections); the embed modules only
// pass it through; the dataset-backed embeds do not use it.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type QuestionContent = Record<string, any>;
export interface SpreadsheetColumn { name: string; type: 'auto' | 'text' | 'number' | 'boolean' | 'date' }

// ── Viz envelope + recipe schemas — VERBATIM from minusx atlas-schemas ──────
const VIZ_TYPES = [
  'table', 'bar', 'line', 'scatter', 'area', 'funnel', 'pie', 'pivot',
  'trend', 'waterfall', 'combo', 'radar', 'geo', 'single_value', 'row',
  'choropleth', 'point_map',
] as const;
export const VisualizationType = StringEnum(VIZ_TYPES);
export type VisualizationType = Static<typeof VisualizationType>;

// -- Geo configs (discriminated by subType) --
const geoBase = {
  mapName: Nullable(Type.String({ description: "base GeoJSON map: 'world', 'us-states', 'india-states'" })),
  showTiles: Nullable(Type.Boolean({ description: 'toggle OpenStreetMap tile layer' })),
  pinnedCenter: Nullable(Type.Array(Type.Number(), { description: 'pinned map center as [lat, lng]' })),
  pinnedZoom: Nullable(Type.Integer({ description: 'pinned map zoom level' })),
};

export const ChoroplethConfig = Type.Object({
  ...geoBase,
  subType: Type.Literal('choropleth', { description: 'geo visualization sub-type' }),
  regionCol: Nullable(Type.String({ description: 'column matching GeoJSON feature names' })),
  valueCol: Nullable(Type.String({ description: 'numeric value column for fill color' })),
  colorScale: Nullable(Type.String({ description: "color scale: 'green' (default), 'blue', 'red-yellow-green'" })),
}, { title: 'ChoroplethConfig' });
export type ChoroplethConfig = Static<typeof ChoroplethConfig>;

export const PointsConfig = Type.Object({
  ...geoBase,
  subType: Type.Literal('points', { description: 'geo visualization sub-type' }),
  latCol: Nullable(Type.String({ description: 'latitude column' })),
  lngCol: Nullable(Type.String({ description: 'longitude column' })),
  valueCol: Nullable(Type.String({ description: 'numeric value column for bubble sizing (optional)' })),
  colorCol: Nullable(Type.String({ description: 'column for coloring points by value (categorical or numeric)' })),
  colorScale: Nullable(Type.String({ description: "color scale for numeric colorCol: 'green' (default), 'blue', 'red-yellow-green'" })),
  minRadius: Nullable(Type.Integer({ description: 'minimum circle radius in pixels (default 5, range 1-20)' })),
  radiusScale: Nullable(Type.Number({ description: 'radius multiplier (default 1, e.g. 2 = double size)' })),
}, { title: 'PointsConfig' });
export type PointsConfig = Static<typeof PointsConfig>;

export const LinesConfig = Type.Object({
  ...geoBase,
  subType: Type.Literal('lines', { description: 'geo visualization sub-type' }),
  latCol: Nullable(Type.String({ description: 'origin latitude column' })),
  lngCol: Nullable(Type.String({ description: 'origin longitude column' })),
  latCol2: Nullable(Type.String({ description: 'destination latitude column' })),
  lngCol2: Nullable(Type.String({ description: 'destination longitude column' })),
}, { title: 'LinesConfig' });
export type LinesConfig = Static<typeof LinesConfig>;

export const HeatmapConfig = Type.Object({
  ...geoBase,
  subType: Type.Literal('heatmap', { description: 'geo visualization sub-type' }),
  latCol: Nullable(Type.String({ description: 'latitude column' })),
  lngCol: Nullable(Type.String({ description: 'longitude column' })),
  valueCol: Nullable(Type.String({ description: 'numeric intensity column (optional, defaults to 1)' })),
  colorScale: Nullable(Type.String({ description: "color scale: 'green' (default), 'blue', 'red-yellow-green'" })),
}, { title: 'HeatmapConfig' });
export type HeatmapConfig = Static<typeof HeatmapConfig>;

export const GeoConfig = Type.Union([ChoroplethConfig, PointsConfig, LinesConfig, HeatmapConfig]);
export type GeoConfig = Static<typeof GeoConfig>;

export const AggregationFunction = StringEnum(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX']);
export type AggregationFunction = Static<typeof AggregationFunction>;

export const FormulaOperator = StringEnum(['+', '-', '*', '/']);
export type FormulaOperator = Static<typeof FormulaOperator>;

export const PivotValueConfig = Type.Object({
  column: Type.String({ description: 'column name for the measure' }),
  aggFunction: Type.Optional(StringEnum(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'], 'aggregation function to apply (SUM, AVG, COUNT, MIN, MAX)')),
}, { title: 'PivotValueConfig' });
export type PivotValueConfig = Static<typeof PivotValueConfig>;

export const PivotFormula = Type.Object({
  name: Type.String({ description: "display label, e.g. 'YoY Change'" }),
  operandA: Type.String({ description: "dimension value, e.g. '2024'" }),
  operandB: Type.String({ description: "dimension value, e.g. '2023'" }),
  operator: StringEnum(['+', '-', '*', '/'], 'arithmetic operator: +, -, *, /'),
  dimensionLevel: Nullable(Type.Integer({ description: 'which dimension level to match (0=top-level, 1=second level, etc.). Defaults to 0.' })),
  parentValues: Nullable(Type.Array(Type.String(), { description: "parent dimension values to scope the formula when dimensionLevel > 0, e.g. ['PnL'] means only match within the PnL group" })),
}, { title: 'PivotFormula' });
export type PivotFormula = Static<typeof PivotFormula>;

export const PivotConfig = Type.Object({
  rows: Type.Array(Type.String(), { description: 'dimension columns for row headers' }),
  columns: Type.Array(Type.String(), { description: 'dimension columns for column headers' }),
  values: Type.Array(PivotValueConfig, { description: 'measures with per-value aggregation functions' }),
  showRowTotals: Nullable(Type.Boolean({ description: 'show row totals column' })),
  showColumnTotals: Nullable(Type.Boolean({ description: 'show column totals row' })),
  showHeatmap: Nullable(Type.Boolean({ description: 'show heatmap conditional formatting' })),
  compact: Nullable(Type.Boolean({ description: 'DEPRECATED compact heatmap mode (GitHub-contribution-graph look) — kept rendering for legacy pivots; prefer the dedicated heatmap viz type (vega-lite rect mark) instead' })),
  heatmapScale: Nullable(Type.String({ description: "heatmap color scale: 'red-yellow-green' (default), 'green' (single-hue like GitHub), 'blue' (single-hue blue)" })),
  rowFormulas: Nullable(Type.Array(PivotFormula, { description: 'formulas combining top-level row dimension values' })),
  columnFormulas: Nullable(Type.Array(PivotFormula, { description: 'formulas combining top-level column dimension values' })),
}, { title: 'PivotConfig' });
export type PivotConfig = Static<typeof PivotConfig>;

export const AxisScale = StringEnum(['linear', 'log']);
export type AxisScale = Static<typeof AxisScale>;

export const AxisConfig = Type.Object({
  xScale: Nullable(StringEnum(['linear', 'log'], "X-axis scale type: 'linear' (default) or 'log'")),
  yScale: Nullable(StringEnum(['linear', 'log'], "Y-axis scale type: 'linear' (default) or 'log'")),
  xMin: Nullable(Type.Number({ description: 'explicit X-axis minimum value' })),
  xMax: Nullable(Type.Number({ description: 'explicit X-axis maximum value' })),
  yMin: Nullable(Type.Number({ description: 'explicit Y-axis minimum value' })),
  yMax: Nullable(Type.Number({ description: 'explicit Y-axis maximum value' })),
  yTitle: Nullable(Type.String({ description: 'optional Y-axis title override for charts with a single Y axis' })),
  dualAxis: Nullable(Type.Boolean({ description: 'enable dual Y-axis mode. When true, yRightCols in VizSettings determines which columns go on the right axis.' })),
}, { title: 'AxisConfig' });
export type AxisConfig = Static<typeof AxisConfig>;

export const ColumnFormatConfig = Type.Object({
  alias: Nullable(Type.String({ description: 'display name override for the column header' })),
  format: Nullable(Type.String({ description:
    "d3 format string for numeric values — the VEGA-TIER vocabulary (recipe sources): e.g. ',.0f', " +
    "'$,.2f', '.2~s'. Takes precedence over decimalPoints/prefix/suffix. DOM grids (table/pivot) " +
    'ignore it — they use the fields below.' })),
  decimalPoints: Nullable(Type.Integer({ description: 'number of decimal places (0-4) for numeric columns' })),
  dateFormat: Nullable(Type.String({ description: "date display format as a Unicode date pattern, e.g. 'yyyy-MM-dd', 'MM/dd/yyyy', 'dd/MM/yyyy', 'MMM dd, yyyy', \"MMM'yy\", 'yyyy', 'yyyy-MM-dd HH:mm', 'HH:mm:ss'. Tokens: yyyy (4-digit year), yy (2-digit year), MMMM (full month), MMM (short month), MM (month number), dd (day), HH (hours 24h), mm (minutes), ss (seconds)." })),
  prefix: Nullable(Type.String({ description: "string to prepend to displayed values (e.g. '$', '€')" })),
  suffix: Nullable(Type.String({ description: "string to append to displayed values (e.g. '%', ' units', 'k')" })),
}, { title: 'ColumnFormatConfig' });
export type ColumnFormatConfig = Static<typeof ColumnFormatConfig>;

export const ConditionFormatRule = Type.Object({
  id: Type.String({ description: 'stable unique id for this rule' }),
  column: Type.String({ description: 'the column whose value the condition is checked against' }),
  operator: StringEnum(['=', '!=', '>', '<', '>=', '<=', 'contains'], 'comparison operator'),
  value: Type.String({ description: 'value to compare against (coerced to number for numeric columns)' }),
  target: StringEnum(['cell', 'row', 'column'], "what gets painted when the condition matches: the matching 'cell', the entire 'row', or the entire 'column'"),
  bgColor: Type.String({ description: "background color as a hex string, e.g. '#fde68a'" }),
}, { title: 'ConditionFormatRule' });
export type ConditionFormatRule = Static<typeof ConditionFormatRule>;

export const ColorScaleFormatRule = Type.Object({
  id: Type.String({ description: 'stable unique id for this rule' }),
  column: Type.String({ description: 'numeric column whose cells are painted with a min→max colour ramp over the column values (heatmap cells)' }),
  scale: StringEnum(['red-yellow-green', 'green', 'blue'], "colour ramp: 'red-yellow-green' (diverging, default), 'green' (single-hue, GitHub-like), 'blue' (single-hue)"),
}, { title: 'ColorScaleFormatRule' });
export type ColorScaleFormatRule = Static<typeof ColorScaleFormatRule>;

// A conditional format is EITHER a condition rule (paint when a predicate holds)
// or a colour-scale rule (min→max ramp over a numeric column).
export const ConditionalFormatRule = Type.Union([ConditionFormatRule, ColorScaleFormatRule], { title: 'ConditionalFormatRule' });
export type ConditionalFormatRule = Static<typeof ConditionalFormatRule>;

export const VisualizationStyleConfig = Type.Object({
  colors: Nullable(Type.Record(Type.String(), Type.String(), { description: "color overrides mapping series index to color key (e.g. {'0': 'danger', '2': 'warning'})." })),
  opacity: Nullable(Type.Number({ description: 'series opacity from 0.1 to 1.0' })),
  markerSize: Nullable(Type.Integer({ description: 'point marker size for charts that render markers, such as scatter and line' })),
  stacked: Nullable(Type.Boolean({ description: 'whether bar and area series should be stacked. Defaults to true for those chart types.' })),
  showDataLabels: Nullable(Type.Boolean({ description: 'show numeric value labels on each data point. Defaults to false.' })),
  dataLabelColor: Nullable(Type.String({ description: "color for the data value labels as a hex string, e.g. '#ffffff'. Defaults to black on bars and the series color otherwise. Only relevant when showDataLabels is true." })),
}, { title: 'VisualizationStyleConfig' });
export type VisualizationStyleConfig = Static<typeof VisualizationStyleConfig>;

export const TrendCompareMode = StringEnum(['last', 'previous']);
export type TrendCompareMode = Static<typeof TrendCompareMode>;

export const TrendConfig = Type.Object({
  compareMode: Nullable(StringEnum(['last', 'previous'], "which periods to compare: 'last' (default, last vs second-to-last) or 'previous' (second-to-last vs third-to-last, skips partial current period)")),
}, { title: 'TrendConfig' });
export type TrendConfig = Static<typeof TrendConfig>;

// Typographic control for the single_value (big number) viz. The number is ALWAYS live (read
// from the query result) — these props only style/decorate it; they never replace the value.
export const SingleValueConfig = Type.Object({
  label: Nullable(Type.String({ description: 'override the displayed label (defaults to the metric column name); set to an empty string to hide the label' })),
  prefix: Nullable(Type.String({ description: "text shown immediately before the number, e.g. '$'" })),
  suffix: Nullable(Type.String({ description: "text shown immediately after the number, e.g. '%' or ' MRR'" })),
  valueSize: Nullable(Type.String({ description: "CSS font-size for the number, e.g. '4rem' or 'clamp(2rem, 10cqi, 6rem)'. Omit for the responsive default." })),
  valueColor: Nullable(Type.String({ description: 'CSS color for the number, e.g. "#16a34a" (a CSS color string, not a theme token)' })),
  valueWeight: Nullable(Type.Integer({ description: 'font weight for the number (100-900)' })),
  labelColor: Nullable(Type.String({ description: 'CSS color for the label' })),
  align: Nullable(StringEnum(['left', 'center', 'right'], 'horizontal alignment of the value block (default center)')),
}, { title: 'SingleValueConfig' });
export type SingleValueConfig = Static<typeof SingleValueConfig>;

export const ChartAnnotation = Type.Object({
  x: Type.Union([Type.String(), Type.Number()], { description: 'X-axis value to anchor the annotation to' }),
  series: Nullable(Type.String({ description: 'series name to anchor the annotation to' })),
  text: Type.String({ description: 'annotation label text' }),
}, { title: 'ChartAnnotation' });
export type ChartAnnotation = Static<typeof ChartAnnotation>;

export const VizSettings = Type.Object({
  type: StringEnum(VIZ_TYPES, 'type of the visualization (default is table)'),
  typeLocked: Nullable(Type.Boolean({ description: 'true once the user manually picked the chart type — semantic (GUI) exploration then stops auto-switching it. Unset/false = the type still tracks the query shape.' })),
  xCols: Nullable(Type.Array(Type.String(), { description: 'list of column names in the x axis (for non-pivot chart types)' })),
  yCols: Nullable(Type.Array(Type.String(), { description: 'list of column names in the y axis (for non-pivot chart types). When dualAxis is enabled in axisConfig, these are the left-axis columns.' })),
  yRightCols: Nullable(Type.Array(Type.String(), { description: 'list of column names for the right Y axis (only used when axisConfig.dualAxis is true)' })),
  tooltipCols: Nullable(Type.Array(Type.String(), { description: 'additional columns to show in chart tooltips without changing grouping or series structure' })),
  pivotConfig: NullableD(PivotConfig, "pivot table configuration (only used when type is 'pivot')"),
  columnFormats: Nullable(Type.Record(Type.String(), ColumnFormatConfig, { description: 'per-column display formatting keyed by column name. Only set when user asks to rename columns, change decimal places, or change date format. Good defaults are applied automatically.' })),
  conditionalFormats: Nullable(Type.Array(ConditionalFormatRule, { description: "conditional background-color rules for table viz. Each rule paints a cell/row/column a color when a condition on a column holds. Only used when type is 'table'." })),
  styleConfig: NullableD(VisualizationStyleConfig, 'shared visual styling for the chart, such as colors, opacity, and marker size.'),
  annotations: Nullable(Type.Array(ChartAnnotation, { description: 'annotations for cartesian charts. Each annotation specifies x, series, and text.' })),
  axisConfig: NullableD(AxisConfig, 'axis configuration for scale type (linear or log). Only set when user explicitly requests log scale.'),
  trendConfig: NullableD(TrendConfig, "trend chart configuration (only used when type is 'trend')"),
  geoConfig: NullableD(GeoConfig, "geo map configuration (only used when type is 'geo')"),
  singleValueConfig: NullableD(SingleValueConfig, "single-value (big number) styling — label, prefix/suffix, font size/color/weight, alignment. The number stays live; these only decorate it. Only used when type is 'single_value'."),
}, { title: 'VizSettings' });
export type VizSettings = Static<typeof VizSettings>;

// ============================================================================
// Viz V2 envelope (CLAUDE.md "Visualization")
//
// Only the MinusX envelope lives in TypeBox. Native Vega-Lite/Vega spec bodies are
// deliberately opaque here (open records) — the grammar is not re-validated.
// Do NOT reproduce the grammars in TypeBox.
// ============================================================================

export const VIZ_GRAMMAR_VEGA_LITE = 'vega-lite@6';
export const VIZ_GRAMMAR_VEGA = 'vega@6';

export const VizSourceRecipe = Type.Object({
  kind: Type.Literal('recipe'),
  recipe: Type.String({ description:
    "a SHIPPED recipe id, e.g. 'minusx/funnel@1' or 'minusx/waterfall@1'. The chart is generated from the " +
    'recipe + bindings at render time — nothing else to author. Available recipes and their bindings are ' +
    'listed in the questions skill.' }),
  bindings: Type.Record(Type.String(), Type.Union([Type.String(), Type.Array(Type.String())]), { description:
    'recipe binding slots → query-result column names (validated against the actual columns). Multi-capable ' +
    "slots (e.g. radar's value) accept an ARRAY of columns — one series per column." }),
  params: Nullable(Type.Record(Type.String(), Type.Unknown(), { description: 'optional recipe params (see the recipe docs); omit for defaults' })),
  columnFormats: Nullable(Type.Record(Type.String(), ColumnFormatConfig, { description:
    'per-column display formatting keyed by RESULT column name, applied at materialization: `alias` ' +
    'renames displays derived from the column name (waterfall y-axis title, radar series names); ' +
    'decimalPoints/prefix/suffix reshape the value labels (waterfall bars, funnel values). Omit for defaults.' })),
}, { title: 'VizSourceRecipe' });
export type VizSourceRecipe = Static<typeof VizSourceRecipe>;

export const VizSourceVegaLite = Type.Object({
  kind: Type.Literal('vega-lite'),
  grammar: Type.Literal(VIZ_GRAMMAR_VEGA_LITE, { description: 'pinned grammar major version; never fetched from the network' }),
  spec: Type.Record(Type.String(), Type.Unknown(), { description:
    'a Vega-Lite spec. Omit `data` — the query result is injected as the named dataset "main" ' +
    '(`data: {"name": "main"}`); external data URLs are rejected. Validated against the official ' +
    'Vega-Lite schema and the query-result columns.' }),
  detachedFrom: Nullable(VizSourceRecipe),
}, { title: 'VizSourceVegaLite' });
export type VizSourceVegaLite = Static<typeof VizSourceVegaLite>;

// Raw native-Vega spec — the full-control escape hatch. A recipe is
// "detached" into this via detachRecipe(): its materialized spec is frozen here so the
// agent can edit ANY property (marks, signals, projections, layers) with no recipe
// param. Native Vega expresses charts Vega-Lite can't (projections/signals/geo/tiles),
// so this is where detached radar/trend/geo maps land; VL-engine recipes detach to
// `kind: 'vega-lite'` instead. `assets` carries any named boundary datasets the spec
// references (geo maps), injected at render exactly like a recipe's assets. `detachedFrom`
// keeps the original recipe source so the chart can be RE-ATTACHED (reset), discarding edits.
export const VizSourceVega = Type.Object({
  kind: Type.Literal('vega'),
  grammar: Type.Literal(VIZ_GRAMMAR_VEGA, { description: 'pinned grammar major version; never fetched from the network' }),
  spec: Type.Record(Type.String(), Type.Unknown(), { description:
    'a native Vega spec. The query result is bound as the named dataset "main" (`data: [{"name": "main"}]`); ' +
    'external data URLs are rejected. Edit this directly to fully customize a detached chart.' }),
  assets: NullableD(Type.Record(Type.String(), Type.String()), 'named boundary/lookup datasets the spec references → asset ids (geo maps), injected at render'),
  detachedFrom: Nullable(VizSourceRecipe),
}, { title: 'VizSourceVega' });
export type VizSourceVega = Static<typeof VizSourceVega>;

// The DOM grid tier: tables never route through vega. The only persisted
// state is display formatting — sorting/filtering/visibility are ephemeral UI state.
export const VizSourceTable = Type.Object({
  kind: Type.Literal('table'),
  wrapColumns: Type.Optional(Nullable(Type.Array(Type.String(), { description:
    'result column names whose body cells wrap onto multiple lines. Omit/null/[] for the default ' +
    'single-line ellipsis behavior.' }))),
  columnFormats: Nullable(Type.Record(Type.String(), ColumnFormatConfig, { description:
    'per-column display formatting keyed by RESULT column name: `alias` + `format` (d3 — the unified ' +
    'viz vocabulary, numbers and dates). Legacy decimalPoints/dateFormat/prefix/suffix also honored. ' +
    'Omit for sensible defaults.' })),
  conditionalFormats: Nullable(Type.Array(ConditionalFormatRule, { description:
    'conditional background-color rules — each paints cells/rows/columns a color when a condition ' +
    'on a column holds. Omit for none.' })),
  css: Nullable(Type.String({ description:
    'CSS overrides for the table LOOKS (the DOM tier equivalent of a chart spec), scoped to this ' +
    "table automatically. Write rules against the stable class contract: .mx-table, .mx-column, .mx-header-row, " +
    '.mx-th, .mx-row, .mx-cell, .mx-col-<columnName> (per-column), .mx-column-type-<text|number|date|json>, ' +
    '.mx-type-icon (+ .mx-type-icon-<text|number|date|json>), .mx-sort-icon, .mx-filter-icon, ' +
    '.mx-toolbar (bottom bar), ' +
    '.mx-row-odd/.mx-row-even (zebra stripe parity — the default stripe is a CSS rule, restyle or ' +
    'unset it here). Use source.wrapColumns for text wrapping so virtual row heights are measured. ' +
    'Table padding is customizable with --mx-cell-padding-block/inline and ' +
    '--mx-header-padding-block/inline. No @import and no external url() — both are rejected. ' +
    'Omit for the default theme.' })),
}, { title: 'VizSourceTable' });
export type VizSourceTable = Static<typeof VizSourceTable>;

// The pivot grid: same DOM tier + css contract as table; the pivot
// STRUCTURE (rows/columns/values) is real config, so it stays typed — reusing the
// classic PivotConfig schema wholesale (subtotals, heatmap, formulas included).
export const VizSourcePivot = Type.Object({
  kind: Type.Literal('pivot'),
  config: PivotConfig,
  columnFormats: Nullable(Type.Record(Type.String(), ColumnFormatConfig, { description:
    'per-column display formatting keyed by RESULT column name: `alias` renames dimension/value ' +
    'headers, `format` (d3) formats cells and date headers. Omit for sensible defaults.' })),
  conditionalFormats: Nullable(Type.Array(ConditionalFormatRule, { description:
    'conditional background-color rules over VALUE columns (keyed by result column name): condition ' +
    'rules paint cells/rows/columns when a predicate holds; colour-scale rules paint cells min→max ' +
    'along a ramp. Omit for none.' })),
  css: Nullable(Type.String({ description:
    'CSS overrides for the pivot LOOKS, scoped to this pivot automatically. The pivot shares the ' +
    "table's class contract — .mx-table, .mx-header-row, .mx-th, .mx-row (+ .mx-row-odd/.mx-row-even " +
    'zebra), .mx-cell, .mx-col-<columnName> (per value column), .mx-toolbar — plus the root class ' +
    '`.mx-pivot` for element selectors (`.mx-pivot th { … }`). ' +
    'No @import and no external url() — both are rejected. Omit for the default theme.' })),
}, { title: 'VizSourcePivot' });
export type VizSourcePivot = Static<typeof VizSourcePivot>;

// Discriminated on `kind`. `slippy-map` joins this union when it lands
// (additive — see the RFC).
export const VizSource = Type.Union([VizSourceVegaLite, VizSourceVega, VizSourceRecipe, VizSourceTable, VizSourcePivot], { title: 'VizSource' });
export type VizSource = Static<typeof VizSource>;

export const VizEnvelope = Type.Object({
  version: Type.Literal(2),
  source: VizSource,
  // Reserved namespaces — schema-present so saved envelopes never need a shape
  // migration when these land; ignored by the probe runtime.
  dataBindings: Nullable(Type.Record(Type.String(), Type.Unknown(), { description: 'RESERVED: query param bindings (re-execute). Not yet implemented — omit.' })),
  viewParams: Nullable(Type.Record(Type.String(), Type.Unknown(), { description: 'RESERVED: presentation-only params/signals. Not yet implemented — omit.' })),
  interactions: Nullable(Type.Record(Type.String(), Type.Unknown(), { description: 'RESERVED: typed interaction outputs. Not yet implemented — omit.' })),
  assets: Nullable(Type.Record(Type.String(), Type.String(), { description: 'RESERVED: named-asset registry refs (e.g. topojson boundaries). Not yet implemented — omit.' })),
}, { title: 'VizEnvelope' });
export type VizEnvelope = Static<typeof VizEnvelope>;

// ============================================================================
// Viz recipe file content (the `viz` file type)
// ============================================================================
// A workspace `.viz` document: an INERT spec template with declared binding
// slots — data, never code. Identity is the FILE NAME (no name field, no
// version suffix); a same-named file in a nearer folder shadows an ancestor's.
// Charts always freeze the substituted spec at use with the file path recorded
// in `detachedFrom.recipe` (see lib/viz/recipe-file.ts for the token rules).

export const VizRecipeBinding = Type.Object({
  name: Type.String({ description: 'slot name referenced by {{name}} tokens in the template' }),
  label: Type.String({ description: 'human label shown on the drop zone' }),
  accepts: Type.Array(StringEnum(['nominal', 'quantitative', 'temporal']), { description:
    'column kinds this slot accepts (drives drop-zone hints and the {{name:kind}} fallback)' }),
  multi: Type.Optional(Type.Boolean({ description:
    'slot takes an ARRAY of columns (e.g. a fold field list); {{name}} must then be a whole-value token' })),
}, { title: 'VizRecipeBinding' });
export type VizRecipeBinding = Static<typeof VizRecipeBinding>;

export const VizRecipeParam = Type.Object({
  name: Type.String({ description: 'param name referenced by {{name}} tokens in the template' }),
  label: Type.String(),
  default: Type.Optional(Type.Unknown({ description: 'value used when the param is omitted at use' })),
}, { title: 'VizRecipeParam' });
export type VizRecipeParam = Static<typeof VizRecipeParam>;

export const VizRecipeContent = Type.Object({
  description: Type.String({ description: 'one-liner advertised to the agent — say what the chart shows' }),
  engine: StringEnum(['vega-lite', 'vega'], 'grammar of the template'),
  bindings: Type.Array(VizRecipeBinding, { description: 'declared slots; every slot is required at use' }),
  params: Type.Optional(Nullable(Type.Array(VizRecipeParam))),
  template: Type.Record(Type.String(), Type.Unknown(), { description:
    'the spec with {{slot}} tokens. Whole-string "{{slot}}" substitutes the bound value verbatim ' +
    '(arrays for multi slots); embedded {{slot}} string-replaces; "{{slot:kind}}" resolves the bound ' +
    "column's kind (quantitative|temporal|nominal) for encoding types. Omit `data` — the query result " +
    'is injected as the named dataset "main"; external data URLs are rejected.' }),
}, { title: 'VizRecipeContent' });
export type VizRecipeContent = Static<typeof VizRecipeContent>;

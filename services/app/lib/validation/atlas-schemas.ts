/**
 * The TypeBox schemas the story engine validates against: the theme and
 * template enums, the `StoryContent` field structure, and the viz envelope.
 * Their `description` strings are model-facing — an agent reads them as the
 * field's own documentation — so they carry the rule, not just the type.
 */
import { Type, type Static, type TSchema } from 'typebox';
import { STORY_UI_COMPONENT_NAME_LIST } from '@/lib/story-ui/component-names';
import { STORY_THEME_NAMES, type StoryDesignName } from './story-theme-names';
import { STORY_SYSTEM_NAMES } from './story-system-names';

/** Shared helper: a string enum with an optional description. */
const StringEnum = <const T extends readonly string[]>(values: T, description?: string) =>
  Type.Unsafe<T[number]>({ type: 'string', enum: [...values], ...(description ? { description } : {}) });

const Nullable = <T extends TSchema>(schema: T) => Type.Optional(Type.Union([schema, Type.Null()]));

const NullableD = <T extends TSchema>(schema: T, description: string) =>
  Type.Optional(Type.Union([schema, Type.Null()], { description }));

/**
 * The six story design themes. The list lives in a dependency-free leaf
 * (`./story-theme-names`) so the reader can name themes without loading
 * typebox; it is re-exported here for every schema-side caller.
 */
export { STORY_THEME_NAMES };
/** Everything a fence `theme` may name: the six themes, then the design systems (lib/data/story/story-systems). */
export const STORY_DESIGN_NAMES: readonly StoryDesignName[] = [...STORY_THEME_NAMES, ...STORY_SYSTEM_NAMES];
export type { StoryDesignName };

/**
 * The story templates — the document's PAGE TYPE (beat structure + layout
 * grammar, and the runtime behaviour that comes with it: the contents rail for
 * editorial and plan, present mode for a deck), orthogonal to the design.
 */
export const STORY_TEMPLATE_NAMES = ['doc', 'editorial', 'deck', 'scrolly', 'dashboard', 'plan', 'app', 'landing'] as const;
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
    'These are the ONLY Capitalized tags allowed. For prose columns/sidebars, prefer ' +
    '<Grid mode="flow"><GridItem w={8}>…</GridItem><GridItem w={4}>…</GridItem></Grid>. ' +
    'Flow stacks on phones, grows with content, and supports direct column manipulation. ' +
    'Use w and optional minHeight (pixels), never x/y/h, in flow. POSITIONED DASHBOARDS — ' +
    '<Grid><GridItem x={0} y={0} w={8} h={5}>…</GridItem>…</Grid>: 12 columns × 86px rows.'),
  format: Type.Optional(Type.Union([Type.Literal('jsx'), Type.Null()], { description:
    "'jsx' = the story field holds shadcn JSX source rendered by the story interpreter" })),
  theme: Type.Optional(Nullable(StringEnum(STORY_DESIGN_NAMES,
    "Design theme for the story (format:'jsx' only) — picks the named design PERSONALITY (fonts, corner " +
    'radius, chart palette, a light AND a dark token set) the story renders with. One of the six built-in ' +
    'themes; omit/null for the neutral default. Components and utility classes are identical across themes ' +
    'and modes, only the tokens change.'))),
  template: Type.Optional(Nullable(StringEnum(STORY_TEMPLATE_NAMES,
    "Story template (format:'jsx' only) — the document's structural genre: 'doc' (simple notes and prose), 'editorial' (long-read magazine " +
    "feature), 'deck' (slide-section presentation), 'scrolly' (playful scrollytelling), 'dashboard' " +
    '(a Grid of draggable KPI/chart tiles with minimal prose), plan (visual proposals, flows and milestones), ' +
    "'app' (a tool people operate: state, actions, outcomes), 'landing' (one offering, one next action). " +
    'METADATA ONLY: it records intent and drives ' +
    'the structure YOU write; no automatic CSS or layout is applied.'))),
  colorMode: Type.Optional(Nullable(StringEnum(['light', 'dark'],
    "The AUTHOR'S DEFAULT mode for the story surface. Every theme carries both a light and a dark " +
    "palette; omit/null to open in the theme's own default mode (light when unthemed). Readers can flip " +
    'the rendered mode at view time regardless.'))),
}, { title: 'StoryContent' });
export type StoryContent = Static<typeof StoryContent>;

const PivotValueConfig = Type.Object({
  column: Type.String({ description: 'column name for the measure' }),
  aggFunction: Type.Optional(StringEnum(['SUM', 'AVG', 'COUNT', 'MIN', 'MAX'], 'aggregation function to apply (SUM, AVG, COUNT, MIN, MAX)')),
}, { title: 'PivotValueConfig' });
type PivotValueConfig = Static<typeof PivotValueConfig>;

const PivotFormula = Type.Object({
  name: Type.String({ description: "display label, e.g. 'YoY Change'" }),
  operandA: Type.String({ description: "dimension value, e.g. '2024'" }),
  operandB: Type.String({ description: "dimension value, e.g. '2023'" }),
  operator: StringEnum(['+', '-', '*', '/'], 'arithmetic operator: +, -, *, /'),
  dimensionLevel: Nullable(Type.Integer({ description: 'which dimension level to match (0=top-level, 1=second level, etc.). Defaults to 0.' })),
  parentValues: Nullable(Type.Array(Type.String(), { description: "parent dimension values to scope the formula when dimensionLevel > 0, e.g. ['PnL'] means only match within the PnL group" })),
}, { title: 'PivotFormula' });
type PivotFormula = Static<typeof PivotFormula>;

const PivotConfig = Type.Object({
  rows: Type.Array(Type.String(), { description: 'dimension columns for row headers' }),
  columns: Type.Array(Type.String(), { description: 'dimension columns for column headers' }),
  values: Type.Array(PivotValueConfig, { description: 'measures with per-value aggregation functions' }),
  showRowTotals: Nullable(Type.Boolean({ description: 'show row totals column' })),
  showColumnTotals: Nullable(Type.Boolean({ description: 'show column totals row' })),
  showHeatmap: Nullable(Type.Boolean({ description: 'show heatmap conditional formatting' })),
  heatmapScale: Nullable(Type.String({ description: "heatmap color scale: 'red-yellow-green' (default), 'green' (single-hue like GitHub), 'blue' (single-hue blue)" })),
  rowFormulas: Nullable(Type.Array(PivotFormula, { description: 'formulas combining top-level row dimension values' })),
  columnFormulas: Nullable(Type.Array(PivotFormula, { description: 'formulas combining top-level column dimension values' })),
}, { title: 'PivotConfig' });
type PivotConfig = Static<typeof PivotConfig>;

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

const ConditionFormatRule = Type.Object({
  id: Type.String({ description: 'stable unique id for this rule' }),
  column: Type.String({ description: 'the column whose value the condition is checked against' }),
  operator: StringEnum(['=', '!=', '>', '<', '>=', '<=', 'contains'], 'comparison operator'),
  value: Type.String({ description: 'value to compare against (coerced to number for numeric columns)' }),
  target: StringEnum(['cell', 'row', 'column'], "what gets painted when the condition matches: the matching 'cell', the entire 'row', or the entire 'column'"),
  bgColor: Type.String({ description: "background color as a hex string, e.g. '#fde68a'" }),
}, { title: 'ConditionFormatRule' });
type ConditionFormatRule = Static<typeof ConditionFormatRule>;

const ColorScaleFormatRule = Type.Object({
  id: Type.String({ description: 'stable unique id for this rule' }),
  column: Type.String({ description: 'numeric column whose cells are painted with a min→max colour ramp over the column values (heatmap cells)' }),
  scale: StringEnum(['red-yellow-green', 'green', 'blue'], "colour ramp: 'red-yellow-green' (diverging, default), 'green' (single-hue, GitHub-like), 'blue' (single-hue)"),
}, { title: 'ColorScaleFormatRule' });
type ColorScaleFormatRule = Static<typeof ColorScaleFormatRule>;

// A conditional format is EITHER a condition rule (paint when a predicate holds)
// or a colour-scale rule (min→max ramp over a numeric column).
const ConditionalFormatRule = Type.Union([ConditionFormatRule, ColorScaleFormatRule], { title: 'ConditionalFormatRule' });
type ConditionalFormatRule = Static<typeof ConditionalFormatRule>;

// ============================================================================
// Viz V2 envelope
//
// Only the MinusX envelope lives in TypeBox. Native Vega-Lite/Vega spec bodies are
// deliberately opaque here (open records) — the grammar is not re-validated.
// Do NOT reproduce the grammars in TypeBox.
// ============================================================================

const VIZ_GRAMMAR_VEGA_LITE = 'vega-lite@6';
const VIZ_GRAMMAR_VEGA = 'vega@6';

const VizSourceRecipe = Type.Object({
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
type VizSourceRecipe = Static<typeof VizSourceRecipe>;

const VizSourceVegaLite = Type.Object({
  kind: Type.Literal('vega-lite'),
  grammar: Type.Literal(VIZ_GRAMMAR_VEGA_LITE, { description: 'pinned grammar major version; never fetched from the network' }),
  spec: Type.Record(Type.String(), Type.Unknown(), { description:
    'a Vega-Lite spec. Omit `data` — the query result is injected as the named dataset "main" ' +
    '(`data: {"name": "main"}`); external data URLs are rejected. Validated against the official ' +
    'Vega-Lite schema and the query-result columns.' }),
  detachedFrom: Nullable(VizSourceRecipe),
}, { title: 'VizSourceVegaLite' });
type VizSourceVegaLite = Static<typeof VizSourceVegaLite>;

// Raw native-Vega spec — the full-control escape hatch. A recipe is "detached"
// into this: its materialized spec is frozen here so the
// agent can edit ANY property (marks, signals, projections, layers) with no recipe
// param. Native Vega expresses charts Vega-Lite can't (projections/signals/geo/tiles),
// so this is where detached radar/trend/geo maps land; VL-engine recipes detach to
// `kind: 'vega-lite'` instead. `assets` carries any named boundary datasets the spec
// references (geo maps), injected at render exactly like a recipe's assets. `detachedFrom`
// keeps the original recipe source so the chart can be RE-ATTACHED (reset), discarding edits.
const VizSourceVega = Type.Object({
  kind: Type.Literal('vega'),
  grammar: Type.Literal(VIZ_GRAMMAR_VEGA, { description: 'pinned grammar major version; never fetched from the network' }),
  spec: Type.Record(Type.String(), Type.Unknown(), { description:
    'a native Vega spec. The query result is bound as the named dataset "main" (`data: [{"name": "main"}]`); ' +
    'external data URLs are rejected. Edit this directly to fully customize a detached chart.' }),
  assets: NullableD(Type.Record(Type.String(), Type.String()), 'named boundary/lookup datasets the spec references → asset ids (geo maps), injected at render'),
  detachedFrom: Nullable(VizSourceRecipe),
}, { title: 'VizSourceVega' });
type VizSourceVega = Static<typeof VizSourceVega>;

// The DOM grid tier: tables never route through vega. The only persisted
// state is display formatting — sorting/filtering/visibility are ephemeral UI state.
const VizSourceTable = Type.Object({
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
type VizSourceTable = Static<typeof VizSourceTable>;

// The pivot grid: same DOM tier + css contract as table; the pivot
// STRUCTURE (rows/columns/values) is real config, so it stays typed — reusing the
// classic PivotConfig schema wholesale (subtotals, heatmap, formulas included).
const VizSourcePivot = Type.Object({
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
type VizSourcePivot = Static<typeof VizSourcePivot>;

// Discriminated on `kind`, so a new source kind joins additively.
const VizSource = Type.Union([VizSourceVegaLite, VizSourceVega, VizSourceRecipe, VizSourceTable, VizSourcePivot], { title: 'VizSource' });
type VizSource = Static<typeof VizSource>;

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

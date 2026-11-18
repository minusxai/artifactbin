/**
 * What a chart description is, shared by <af-chart> (lib/html-components/chart.ts) and the query
 * image (`POST /api/charts/image`, lib/viz/chart-image.server.ts), so the page and the image refuse
 * the same input. Engine-free and dependency-free: the component bundles it.
 *
 * A description is one of
 *   - a Vega-Lite spec, bare (`{mark, encoding, …}`) or wrapped (`{vegaLite: {…}}`);
 *   - a Vega spec, bare (`{marks: […]}` or a `$schema` naming vega/v…) or wrapped (`{vega: {…}}`);
 *   - a named recipe with column bindings: `{recipe: 'trend', bindings: {date: 'week', value:
 *     'orders'}, params?: {…}}`.
 * Rows bind as the dataset `main` (the spec's own inline `values` stay its own). Refused anywhere
 * in a spec: a `url` key (data, lookups, images): rows reach a chart only by binding, and each
 * view's loader refuses every fetch anyway. A spec is at most CHART_LIMITS.specBytes of JSON and
 * CHART_LIMITS.depth deep. A Vega-Lite data object names its source (values, name, sequence, sphere or graticule):
 * an engine would otherwise throw on it unexplained. `locateChartFailure` names the part of a composed spec an engine
 * failure sits in.
 */

export const CHART_LIMITS = {
  /** Serialized spec (or recipe description) bytes. */
  specBytes: 256 * 1024,
  /** Object/array nesting. */
  depth: 64,
  /** Rows one element draws. */
  rows: 10_000,
} as const;

/** The recipes a description may name (the shipped registry's non-map builders, lib/viz/viz-templates). */
const CHART_RECIPES = ['funnel', 'waterfall', 'radar', 'trend', 'single-value', 'combo'] as const;
type ChartRecipe = typeof CHART_RECIPES[number];

export type ChartDescription =
  | { kind: 'vega-lite'; spec: Record<string, unknown> }
  | { kind: 'vega'; spec: Record<string, unknown> }
  | { kind: 'recipe'; recipe: ChartRecipe; bindings: Record<string, string | string[]>; params?: Record<string, unknown> };

export type ChartParse = { ok: true; value: ChartDescription } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  v != null && typeof v === 'object' && !Array.isArray(v);

/** The first refused key path in a spec, or a size/depth refusal, or null. */
function refusal(spec: unknown): string | null {
  let bytes: number;
  try { bytes = new TextEncoder().encode(JSON.stringify(spec)).length; } catch { return 'the chart is not plain JSON'; }
  if (bytes > CHART_LIMITS.specBytes) return `the chart is ${bytes} bytes of JSON, past ${CHART_LIMITS.specBytes}`;
  const walk = (node: unknown, path: string, depth: number): string | null => {
    if (depth > CHART_LIMITS.depth) return `the chart nests deeper than ${CHART_LIMITS.depth} levels`;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) { const hit = walk(node[i], `${path}[${i}]`, depth + 1); if (hit) return hit; }
    } else if (isRecord(node)) {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'url') {
          return `${path ? path + '.' : ''}url: external data and images are refused; bind rows ` +
            '(sql, a linked dataset or inline values) instead';
        }
        const hit = walk(value, path ? `${path}.${key}` : key, depth + 1); if (hit) return hit;
      }
    }
    return null;
  };
  return walk(spec, '', 0);
}

const DATA_SOURCES = ['values', 'name', 'sequence', 'sphere', 'graticule', 'url'];
const VIEW_LISTS = ['layer', 'hconcat', 'vconcat', 'concat'] as const;
const at = (path: string, key: string) => (path ? `${path}.${key}` : key);

const REPEATED = {
  facet: 'for one panel per value put row/column inside encoding instead',
  repeat: 'name the repeated field in its encoding as {"repeat": "repeat"}',
} as const;

/**
 * The first Vega-Lite shape an engine would throw on unexplained: a data object, in a view or a lookup's `from`, that
 * names no source (Vega-Lite dereferences `data.format`), or a facet or repeat operator with no `spec` to repeat
 * (it destructures the missing spec). Only the view structure is walked: inline rows, `datasets` and `usermeta` may
 * hold anything. `data: null` (no parent data) and `{}` (inherit) pass, as do row/column inside encoding.
 */
function dataProblem(view: unknown, path: string): string | null {
  if (!isRecord(view)) return null;
  for (const [key, fix] of Object.entries(REPEATED)) {
    if (key in view && !isRecord(view.spec)) {
      return `${at(path, key)}: needs a spec: {mark, encoding…} to repeat; ${fix}`;
    }
  }
  const { data } = view;
  if (isRecord(data) && Object.keys(data).length && !DATA_SOURCES.some(key => key in data)) {
    return `${at(path, 'data')}: a data object needs values, name, sequence, sphere or graticule, not ` +
      `${Object.keys(data).join(', ')}; filter rows with transform: [{filter: …}] on the view, and give rows from ` +
      'sql, a dataset or rows no data (they bind as main)';
  }
  const transforms = Array.isArray(view.transform) ? view.transform : [];
  for (const [i, step] of transforms.entries()) {
    const hit = isRecord(step) && dataProblem(step.from, `${at(path, 'transform')}[${i}].from`);
    if (hit) return hit;
  }
  for (const key of VIEW_LISTS) {
    const views = Array.isArray(view[key]) ? view[key] as unknown[] : [];
    for (const [i, child] of views.entries()) {
      const hit = dataProblem(child, `${at(path, key)}[${i}]`);
      if (hit) return hit;
    }
  }
  return dataProblem(view.spec, at(path, 'spec'));
}

/**
 * Where in a composed spec an engine failure sits: the first child of a layer or concat that still fails when it is
 * the only one, its parent's encoding and data kept (`attempt` throws for a failing spec), followed down; null when
 * no child fails alone, or every one does (the parent is at fault).
 */
export function locateChartFailure(spec: Record<string, unknown>,
  attempt: (spec: Record<string, unknown>) => void): string | null {
  const fails = (candidate: Record<string, unknown>) => {
    try { attempt(candidate); return false; } catch { return true; }
  };
  for (const key of VIEW_LISTS) {
    const views = spec[key];
    if (!Array.isArray(views) || views.length < 2) continue;
    const alone = (child: unknown) => ({ ...spec, [key]: [child] });
    const failing = views.map((child) => fails(alone(child)));
    const i = failing.indexOf(true);
    if (i < 0 || failing.every(Boolean)) continue;
    const child = views[i];
    const inner = isRecord(child) ? locateChartFailure(child, (part) => attempt(alone(part))) : null;
    return `${key}[${i}]${inner ? '.' + inner : ''}`;
  }
  return null;
}

/** A description its engine cannot draw: af-chart shows it as invalid_chart, the query image's code for it. */
export class InvalidChart extends Error {}

/**
 * An engine's exception (an InvalidChart passes through) as what is wrong: the spec is not valid, where
 * (locateChartFailure), the engine's words kept; a TypeError (a shape the checks above missed) adds a structure hint.
 */
export function invalidChart(resolved: { engine: 'vega' | 'vega-lite'; spec: Record<string, unknown> }, error: unknown,
  attempt: (spec: Record<string, unknown>) => void): InvalidChart {
  if (error instanceof InvalidChart) return error;
  const where = resolved.engine === 'vega-lite' ? locateChartFailure(resolved.spec, attempt) : null;
  const said = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  return new InvalidChart(`the ${resolved.engine === 'vega' ? 'Vega' : 'Vega-Lite'} spec is not valid` +
    `${where ? ` at ${where}` : ''} (the engine stopped with: ${said})${error instanceof TypeError
      ? '; check its structure: each view is {mark, encoding}, a layer or concat list, or facet or repeat with a spec'
      : ''}`);
}

/** A failed drawing as af-chart shows it: an InvalidChart as invalid_chart (read-failure's shape), anything else as text. */
export function chartFailure(error: unknown): { code: string; message: string; detail: string } | string {
  const text = error instanceof Error ? error.message : String(error);
  if (!(error instanceof InvalidChart)) return `chart not drawn: ${text}`;
  return { code: 'invalid_chart', message: `Chart not drawn: ${text}`, detail: text };
}

const isVegaSpec = (spec: Record<string, unknown>) =>
  Array.isArray(spec.marks) || (typeof spec.$schema === 'string' && /\/vega\/v\d/.test(spec.$schema));

/** Parse and check a description: what both the element and the image accept. */
export function parseChartDescription(input: unknown): ChartParse {
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { return { ok: false, error: 'the chart is not valid JSON' }; }
  }
  if (!isRecord(input)) return { ok: false, error: 'a chart is a Vega-Lite or Vega spec object, or {recipe, bindings}' };
  const bad = refusal(input);
  if (bad) return { ok: false, error: bad };
  if ('recipe' in input) {
    const { recipe, bindings, params } = input;
    if (!CHART_RECIPES.includes(recipe as ChartRecipe)) {
      return { ok: false, error: `unknown recipe ${JSON.stringify(recipe)}: one of ${CHART_RECIPES.join(', ')}` };
    }
    if (!isRecord(bindings) || Object.values(bindings).some(v => typeof v !== 'string'
      && !(Array.isArray(v) && v.every(x => typeof x === 'string')))) {
      return { ok: false, error: 'recipe bindings map each slot to a column name (or a list of them)' };
    }
    if (params !== undefined && !isRecord(params)) return { ok: false, error: 'recipe params is an object' };
    return { ok: true, value: { kind: 'recipe', recipe: recipe as ChartRecipe,
      bindings: bindings as Record<string, string | string[]>, ...(params ? { params } : {}) } };
  }
  if ('vegaLite' in input || 'vega' in input) {
    const keys = Object.keys(input);
    const kind = 'vegaLite' in input ? 'vega-lite' : 'vega';
    const spec = input[kind === 'vega-lite' ? 'vegaLite' : 'vega'];
    if (keys.length !== 1 || !isRecord(spec)) return { ok: false, error: 'wrap exactly one spec: {vegaLite: {…}} or {vega: {…}}' };
    return checked(kind, spec);
  }
  return checked(isVegaSpec(input) ? 'vega' : 'vega-lite', input);
}

function checked(kind: 'vega' | 'vega-lite', spec: Record<string, unknown>): ChartParse {
  const problem = kind === 'vega-lite' ? dataProblem(spec, '') : null;
  return problem ? { ok: false, error: problem } : { ok: true, value: { kind, spec } };
}

/** Column kinds inferred from rows, for recipes that pick an axis by type. */
export function inferColumns(rows: readonly Record<string, unknown>[]): { name: string; kind: 'quantitative' | 'temporal' | 'nominal' | 'boolean' | 'unknown' }[] {
  const names = new Set<string>();
  for (const row of rows.slice(0, 200)) for (const key of Object.keys(row)) names.add(key);
  return [...names].map(name => {
    const values = rows.slice(0, 200).map(r => r[name]).filter(v => v != null);
    if (!values.length) return { name, kind: 'unknown' as const };
    if (values.every(v => typeof v === 'number')) return { name, kind: 'quantitative' as const };
    if (values.every(v => typeof v === 'boolean')) return { name, kind: 'boolean' as const };
    if (values.every(v => typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?([T ][\d:.]+Z?)?$/.test(v))) return { name, kind: 'temporal' as const };
    return { name, kind: 'nominal' as const };
  });
}

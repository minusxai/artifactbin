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
 * CHART_LIMITS.depth deep.
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
export const CHART_RECIPES = ['funnel', 'waterfall', 'radar', 'trend', 'single-value', 'combo'] as const;
export type ChartRecipe = typeof CHART_RECIPES[number];

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
    return { ok: true, value: { kind, spec } };
  }
  return { ok: true, value: { kind: isVegaSpec(input) ? 'vega' : 'vega-lite', spec: input } };
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

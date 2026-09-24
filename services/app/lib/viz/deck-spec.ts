/**
 * THE `<DeckGL>` CONTRACT — what a document may say to the map engine, in
 * deck.gl's own JSON dialect (`@@type`, `@@=` accessors) because agents already
 * write it. One module, no deck.gl import: publish validation (lib/jsx/validate,
 * which `afbin validate` also runs offline), the column checks
 * (lib/story/data-checks) and the renderer (components/kit/deck-gl-engine) all
 * read it, so what publish accepts is exactly what the engine builds.
 *
 * Props are ALLOWLISTED per layer, never denylisted: deck.gl fetches any URL it
 * is handed (`data`, `image`, `mesh`, `loadOptions`…), so an unknown prop is
 * refused rather than passed through. Accessors are parsed into a small tree and
 * interpreted — never `eval`, never a property walk off the row object.
 */
import { GEO_ASSETS } from './geo-assets';

type Rgb = readonly [number, number, number];
/** Theme colours the engine resolves from the document; the accessor colour functions draw from them. */
export interface DeckPalette { sequential: readonly Rgb[]; categorical: readonly Rgb[] }
type Row = Record<string, unknown>;

// ── Layers and their props ────────────────────────────────────────────────────

const COMMON = ['visible', 'opacity', 'pickable', 'autoHighlight', 'highlightColor'];
const LINE = ['lineWidthUnits', 'lineWidthScale', 'lineWidthMinPixels', 'lineWidthMaxPixels'];
const SOLID = ['filled', 'stroked', 'extruded', 'wireframe', 'elevationScale', ...LINE];
const BINS = ['getPosition', 'getColorWeight', 'getElevationWeight', 'colorAggregation', 'elevationAggregation',
  'coverage', 'extruded', 'elevationScale', 'elevationRange', 'colorRange', 'colorDomain', 'elevationDomain',
  'upperPercentile', 'lowerPercentile', 'elevationUpperPercentile', 'elevationLowerPercentile',
  'colorScaleType', 'elevationScaleType', 'gpuAggregation'];

/** Every layer a document may draw, and every prop it may set on it. */
export const DECK_LAYERS: Record<string, readonly string[]> = {
  ScatterplotLayer: ['getPosition', 'getRadius', 'getFillColor', 'getLineColor', 'getLineWidth', 'radiusUnits',
    'radiusScale', 'radiusMinPixels', 'radiusMaxPixels', 'filled', 'stroked', 'billboard', 'antialiasing', ...LINE],
  ArcLayer: ['getSourcePosition', 'getTargetPosition', 'getSourceColor', 'getTargetColor', 'getWidth', 'getHeight',
    'getTilt', 'greatCircle', 'numSegments', 'widthUnits', 'widthScale', 'widthMinPixels', 'widthMaxPixels'],
  GeoJsonLayer: ['getFillColor', 'getLineColor', 'getLineWidth', 'getElevation', 'getPointRadius', 'pointRadiusUnits',
    'pointRadiusScale', 'pointRadiusMinPixels', 'pointRadiusMaxPixels', ...SOLID],
  ColumnLayer: ['getPosition', 'getElevation', 'getFillColor', 'getLineColor', 'getLineWidth', 'radius', 'angle',
    'vertices', 'offset', 'coverage', 'diskResolution', 'radiusUnits', 'flatShading', ...SOLID],
  HexagonLayer: [...BINS, 'radius'],
  GridLayer: [...BINS, 'cellSize'],
  HeatmapLayer: ['getPosition', 'getWeight', 'radiusPixels', 'colorRange', 'intensity', 'threshold', 'colorDomain',
    'aggregation', 'weightsTextureSize', 'debounceTimeout'],
  H3HexagonLayer: ['getHexagon', 'getFillColor', 'getLineColor', 'getLineWidth', 'getElevation', 'coverage',
    'highPrecision', ...SOLID],
};

/** `<DeckGL basemap>`: a street basemap under the layers, or none (boundaries alone). */
export const DECK_BASEMAPS = ['auto', 'light', 'dark', 'none'] as const;
const VIEW_KEYS = ['longitude', 'latitude', 'zoom', 'pitch', 'bearing'];
/**
 * Layer `data`: omitted (the component's query rows) or an allowlisted bundled
 * boundary. An author's OWN GeoJSON is a dataset (`afbin add zones.geojson`
 * makes one row per feature with a `geometry` column), read through a Query
 * like any other rows — so a GeoJsonLayer without `data` draws that column.
 */
export const BOUNDARY_PREFIX = 'boundary:';
/** The column a GeoJsonLayer reads feature geometry from when it draws query rows. */
export const GEOMETRY_COLUMN = 'geometry';

const isAccessorProp = (prop: string) => prop.startsWith('get');
const isColorProp = (prop: string) => isAccessorProp(prop) && prop.endsWith('Color');
const isLiteral = (v: unknown): boolean =>
  typeof v === 'number' ? Number.isFinite(v)
    : typeof v === 'boolean' || typeof v === 'string' || v === null
      || (Array.isArray(v) && v.length <= 64 && v.every(isLiteral));

/** The bundled boundary a layer draws instead of the component's query rows, or null. */
export const layerBoundary = (layer: Row): string | null =>
  typeof layer.data === 'string' && layer.data.startsWith(BOUNDARY_PREFIX) ? layer.data.slice(BOUNDARY_PREFIX.length) : null;

/**
 * Every problem with a `<DeckGL>`'s props, as author-facing messages. Empty
 * means the engine will build exactly these layers.
 */
export function validateDeckMap(props: { layers?: unknown; basemap?: unknown; initialViewState?: unknown; tooltip?: unknown }): string[] {
  const out: string[] = [];
  if (props.tooltip !== undefined && typeof props.tooltip !== 'boolean' && !(Array.isArray(props.tooltip) && props.tooltip.every(c => typeof c === 'string'))) {
    out.push('DeckGL tooltip must be true, false or a list of columns, e.g. ["city", "orders"]');
  }
  if (props.basemap !== undefined && !(DECK_BASEMAPS as readonly unknown[]).includes(props.basemap)) {
    out.push(`DeckGL basemap must be one of ${DECK_BASEMAPS.join(', ')}`);
  }
  if (props.initialViewState !== undefined) {
    const view = props.initialViewState;
    if (!view || typeof view !== 'object' || Array.isArray(view)) out.push('DeckGL initialViewState must be an object');
    else for (const [key, value] of Object.entries(view)) {
      if (!VIEW_KEYS.includes(key)) out.push(`DeckGL initialViewState.${key} is not supported (use ${VIEW_KEYS.join(', ')})`);
      else if (typeof value !== 'number' || !Number.isFinite(value)) out.push(`DeckGL initialViewState.${key} must be a number`);
    }
  }
  if (!Array.isArray(props.layers)) return [...out, 'DeckGL layers must be an array of layer objects, e.g. [{"@@type":"ScatterplotLayer", …}]'];
  props.layers.forEach((layer, i) => out.push(...validateLayer(layer, i)));
  return out;
}

function validateLayer(layer: unknown, index: number): string[] {
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) return [`DeckGL layers[${index}] must be an object`];
  const spec = layer as Row;
  const type = spec['@@type'];
  const allowed = typeof type === 'string' ? DECK_LAYERS[type] : undefined;
  if (!allowed) return [`DeckGL layers[${index}]: "@@type" ${JSON.stringify(type)} is not a supported layer (use ${Object.keys(DECK_LAYERS).join(', ')})`];
  const at = `DeckGL ${type} (layers[${index}])`;
  const out: string[] = [];
  const boundary = layerBoundary(spec);
  for (const [prop, value] of Object.entries(spec)) {
    if (prop === '@@type') continue;
    if (prop === 'data') {
      if (boundary === null) {
        out.push(`${at}: data must be omitted (the component's query) or "${BOUNDARY_PREFIX}<id>" — never a URL; your own GeoJSON is a dataset you query`);
      } else if (type !== 'GeoJsonLayer') {
        out.push(`${at}: only a GeoJsonLayer draws a boundary; point layers read the component's query`);
      } else if (!(boundary in GEO_ASSETS)) {
        out.push(`${at}: unknown boundary "${boundary}" (bundled: ${Object.keys(GEO_ASSETS).join(', ')})`);
      }
      continue;
    }
    if (prop === '@@join') {
      if (boundary === null) out.push(`${at}: @@join joins query rows onto a bundled boundary's features; it needs data "${BOUNDARY_PREFIX}<id>"`);
      else if (!Array.isArray(value) || value.length !== 2 || !value.every(v => typeof v === 'string' && v)) {
        out.push(`${at}: @@join must be ["<feature property>", "<query column>"]`);
      }
      continue;
    }
    if (!allowed.includes(prop) && !COMMON.includes(prop)) { out.push(`${at}: prop "${prop}" is not supported`); continue; }
    if (typeof value === 'string' && value.startsWith('@@')) {
      if (!isAccessorProp(prop)) { out.push(`${at}: ${prop} takes a literal value, not an accessor`); continue; }
      if (!value.startsWith('@@=')) { out.push(`${at}: ${prop} must be a "@@=" expression; "@@function" and other forms are not supported`); continue; }
      try {
        const calls = collectCalls(parse(value.slice(3)));
        const colorOnly = calls.filter(c => COLOR_FUNCTIONS.has(c));
        if (colorOnly.length && !isColorProp(prop)) out.push(`${at}: ${colorOnly[0]}() picks a theme colour; use it in a get…Color accessor, not ${prop}`);
      } catch (error) { out.push(`${at}: ${prop}: ${(error as Error).message}`); }
      continue;
    }
    if (!isLiteral(value)) out.push(`${at}: ${prop} must be a number, string, boolean or array`);
  }
  return out;
}

/**
 * The query columns a `<DeckGL>`'s layers read — for the publish-time check
 * against the query's result. Boundary layers read feature properties, so only
 * their `@@join` column comes from the query; a GeoJsonLayer over the query's
 * own rows needs its `geometry` column.
 */
export function deckColumns(layers: unknown): string[] {
  const out = new Set<string>();
  if (!Array.isArray(layers)) return [];
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object') continue;
    const spec = layer as Row;
    if (layerBoundary(spec) !== null) {
      const join = spec['@@join'];
      if (Array.isArray(join) && typeof join[1] === 'string') out.add(join[1]);
      continue;
    }
    if (spec['@@type'] === 'GeoJsonLayer') out.add(GEOMETRY_COLUMN);
    for (const [prop, value] of Object.entries(spec)) {
      if (!isAccessorProp(prop) || typeof value !== 'string' || !value.startsWith('@@=')) continue;
      try { for (const c of collectColumns(parse(value.slice(3)))) out.add(c); } catch { /* validation reports it */ }
    }
  }
  return [...out];
}

// ── The accessor grammar ──────────────────────────────────────────────────────
//
//   expr    := or ('?' expr ':' expr)?
//   or      := and ('||' and)*          and := cmp ('&&' cmp)*
//   cmp     := sum (('=='|'!='|'<'|'<='|'>'|'>=') sum)?
//   sum     := product (('+'|'-') product)*
//   product := unary (('*'|'/'|'%') unary)*
//   unary   := ('-'|'!') unary | primary
//   primary := number | 'string' | column | fn '(' args ')' | '[' args ']' | '(' expr ')'
//
// A bare name is a column of the row (or of a GeoJSON feature's properties).

type Node =
  | { k: 'num'; v: number } | { k: 'str'; v: string } | { k: 'lit'; v: boolean | null }
  | { k: 'col'; name: string } | { k: 'arr'; items: Node[] } | { k: 'call'; fn: string; args: Node[] }
  | { k: 'un'; op: string; arg: Node } | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'if'; test: Node; then: Node; else: Node };

const MATH: Record<string, (...xs: number[]) => number> = {
  sqrt: Math.sqrt, log: Math.log, log10: Math.log10, abs: Math.abs, min: Math.min, max: Math.max,
  round: Math.round, floor: Math.floor, ceil: Math.ceil,
};
const COLOR_FUNCTIONS = new Set(['ramp', 'category']);
const MAX_SOURCE = 500;

const TOKEN = /\s*(?:(\d+(?:\.\d+)?(?:e[+-]?\d+)?)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([A-Za-z_][A-Za-z0-9_]*)|(==|!=|<=|>=|&&|\|\||[-+*/%<>!?:()[\],]))/y;

function tokenize(src: string): string[] {
  if (src.length > MAX_SOURCE) throw new Error(`expression is longer than ${MAX_SOURCE} characters`);
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(TOKEN.lastIndex))) break;
    const start = TOKEN.lastIndex;
    const m = TOKEN.exec(src);
    if (!m) throw new Error(`unexpected "${src.slice(start).trim().slice(0, 12)}" in expression`);
    out.push(m[0].trim());
  }
  return out;
}

function parse(src: string): Node {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const take = (t?: string) => {
    const tok = tokens[i];
    if (tok === undefined || (t !== undefined && tok !== t)) throw new Error(t ? `expected "${t}"` : 'expression ended early');
    i++;
    return tok;
  };
  const list = (close: string): Node[] => {
    const items: Node[] = [];
    if (peek() === close) { take(close); return items; }
    for (;;) { items.push(expr()); if (peek() === ',') take(','); else { take(close); return items; } }
  };
  const primary = (): Node => {
    const t = take();
    if (/^\d/.test(t)) return { k: 'num', v: Number(t) };
    if (t[0] === "'" || t[0] === '"') return { k: 'str', v: t.slice(1, -1).replace(/\\(.)/g, '$1') };
    if (t === '[') return { k: 'arr', items: list(']') };
    if (t === '(') { const e = expr(); take(')'); return e; }
    if (/^[A-Za-z_]/.test(t)) {
      if (t === 'true' || t === 'false') return { k: 'lit', v: t === 'true' };
      if (t === 'null') return { k: 'lit', v: null };
      if (peek() === '(') {
        if (!(t in MATH) && !COLOR_FUNCTIONS.has(t)) throw new Error(`unknown function "${t}" (use ${[...Object.keys(MATH), ...COLOR_FUNCTIONS].join(', ')})`);
        take('(');
        const args = list(')');
        if (COLOR_FUNCTIONS.has(t) && args.length !== 1) throw new Error(`${t}() takes one column`);
        return { k: 'call', fn: t, args };
      }
      return { k: 'col', name: t };
    }
    throw new Error(`unexpected "${t}" in expression`);
  };
  const unary = (): Node => (peek() === '-' || peek() === '!') ? { k: 'un', op: take(), arg: unary() } : primary();
  const binary = (next: () => Node, ops: string[], once = false) => (): Node => {
    let a = next();
    while (ops.includes(peek() ?? '')) { a = { k: 'bin', op: take(), a, b: next() }; if (once) break; }
    return a;
  };
  const product = binary(unary, ['*', '/', '%']);
  const sum = binary(product, ['+', '-']);
  const cmp = binary(sum, ['==', '!=', '<', '<=', '>', '>='], true);
  const and = binary(cmp, ['&&']);
  const or = binary(and, ['||']);
  function expr(): Node {
    const test = or();
    if (peek() !== '?') return test;
    take('?');
    const then = expr();
    take(':');
    return { k: 'if', test, then, else: expr() };
  }
  const root = expr();
  if (i < tokens.length) throw new Error(`unexpected "${tokens[i]}" in expression`);
  return root;
}

const walk = (n: Node, visit: (n: Node) => void): void => {
  visit(n);
  if (n.k === 'arr') n.items.forEach(x => walk(x, visit));
  else if (n.k === 'call') n.args.forEach(x => walk(x, visit));
  else if (n.k === 'un') walk(n.arg, visit);
  else if (n.k === 'bin') { walk(n.a, visit); walk(n.b, visit); }
  else if (n.k === 'if') { walk(n.test, visit); walk(n.then, visit); walk(n.else, visit); }
};
const collectCalls = (n: Node) => { const out: string[] = []; walk(n, x => { if (x.k === 'call') out.push(x.fn); }); return out; };
const collectColumns = (n: Node) => { const out: string[] = []; walk(n, x => { if (x.k === 'col') out.push(x.name); }); return out; };

/** A row's column, or a GeoJSON feature's property — own keys only, so no prototype walk. */
function column(row: unknown, name: string): unknown {
  if (!row || typeof row !== 'object') return undefined;
  const own = (o: object) => Object.prototype.hasOwnProperty.call(o, name) ? (o as Row)[name] : undefined;
  const direct = own(row);
  if (direct !== undefined) return direct;
  const props = (row as Row).properties;
  return props && typeof props === 'object' ? own(props) : undefined;
}

/**
 * Compile a `@@=` expression (without the prefix) into a deck accessor over
 * `data`. `ramp(col)` spreads the column's numeric domain over the sequential
 * palette; `category(col)` gives each distinct value the next categorical colour.
 */
export function compileAccessor(src: string, data: readonly unknown[], palette: DeckPalette): (row: unknown) => unknown {
  const root = parse(src);
  const scales = new Map<Node, (v: unknown) => number[]>();
  walk(root, n => {
    if (n.k !== 'call' || !COLOR_FUNCTIONS.has(n.fn)) return;
    const arg = n.args[0]!;
    const values = data.map(d => evaluate(arg, d));
    if (n.fn === 'ramp') {
      const nums = values.map(Number).filter(Number.isFinite);
      const lo = nums.length ? Math.min(...nums) : 0, hi = nums.length ? Math.max(...nums) : 1;
      const steps = palette.sequential;
      scales.set(n, v => {
        const x = Number(v);
        if (!Number.isFinite(x) || !steps.length) return [160, 160, 160, 80];
        const t = hi > lo ? (x - lo) / (hi - lo) : 0.5;
        return [...steps[Math.round(t * (steps.length - 1))]!, 255];
      });
    } else {
      const order = new Map<string, number>();
      for (const v of values) if (!order.has(String(v))) order.set(String(v), order.size);
      const colors = palette.categorical;
      scales.set(n, v => colors.length ? [...colors[(order.get(String(v)) ?? 0) % colors.length]!, 255] : [160, 160, 160, 255]);
    }
  });
  function evaluate(n: Node, row: unknown): unknown {
    switch (n.k) {
      case 'num': case 'str': case 'lit': return n.v;
      case 'col': return column(row, n.name);
      case 'arr': return n.items.map(x => evaluate(x, row));
      case 'un': { const v = evaluate(n.arg, row); return n.op === '-' ? -Number(v) : !v; }
      case 'if': return evaluate(n.test, row) ? evaluate(n.then, row) : evaluate(n.else, row);
      case 'call': {
        const scale = scales.get(n);
        if (scale) return scale(evaluate(n.args[0]!, row));
        return MATH[n.fn]!(...n.args.map(x => Number(evaluate(x, row))));
      }
      case 'bin': {
        if (n.op === '&&') return evaluate(n.a, row) && evaluate(n.b, row);
        if (n.op === '||') return evaluate(n.a, row) || evaluate(n.b, row);
        const a = evaluate(n.a, row), b = evaluate(n.b, row);
        switch (n.op) {
          case '==': return a === b || (a != null && b != null && String(a) === String(b));
          case '!=': return !(a === b || (a != null && b != null && String(a) === String(b)));
          case '+': return typeof a === 'string' || typeof b === 'string' ? `${a ?? ''}${b ?? ''}` : Number(a) + Number(b);
          case '-': return Number(a) - Number(b);
          case '*': return Number(a) * Number(b);
          case '/': return Number(a) / Number(b);
          case '%': return Number(a) % Number(b);
          case '<': return Number(a) < Number(b);
          case '<=': return Number(a) <= Number(b);
          case '>': return Number(a) > Number(b);
          case '>=': return Number(a) >= Number(b);
        }
      }
    }
    return undefined;
  }
  return row => evaluate(root, row);
}

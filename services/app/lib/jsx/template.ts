/**
 * TEMPLATES IN STRINGS: `{$value}`, `{$query.column}` and `{$_row.column}` inside any authored string.
 *
 * One grammar for every place a string is read — an attribute, a kit prop, a chart spec's leaves — and
 * one pure resolver the server render and the browser both run, so the served markup and the hydrated
 * page agree byte for byte. A hole is the parser's own reactive expression (lib/jsx/reactive): a signal
 * (`region`, a query cell `tiles.cheap_v`, a built-in `_me.id`) or a row field. RAW values only: no
 * calls, no format syntax — formatting stays in SQL or in a `<Cell>`.
 *
 * Attribute values are guarded after substitution (lib/jsx/template-attrs) with the row attributes' rules (kit/basic rowAttrs): a
 * URL attribute whose result has a dangerous scheme, or a hole without a value, resolves to no attribute
 * at all; an SVG paint reference must stay local; a value substituted into `style` that could end the
 * declaration or fetch something (`;`, braces, quotes, backslashes, newlines, `url(`…) is not substituted.
 */
import type { ReactiveExpression } from './reactive';

/** One hole: a page value, a query's first-row cell, a built-in's field (`signal`), or a row field. */
type TemplateHole = Extract<ReactiveExpression, { kind: 'signal' } | { kind: 'row' }>;
export type TemplatePart = string | TemplateHole;

const HOLE = /\{\s*\$([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?\s*\}/g;

/**
 * The parts of a templated string, or null when it holds no hole (the common case: callers keep the
 * literal untouched). `{$_row}` alone and anything outside the grammar stay literal text.
 */
export function parseTemplate(value: unknown): TemplatePart[] | null {
  if (typeof value !== 'string' || !value.includes('{')) return null;
  const parts: TemplatePart[] = [];
  let last = 0, holes = 0;
  for (const m of value.matchAll(HOLE)) {
    const [whole, name, field] = m as unknown as [string, string, string | undefined];
    let hole: TemplateHole | null = null;
    if (name === '_row') hole = field ? { kind: 'row', field } : null;
    else hole = { kind: 'signal', name: field ? `${name}.${field}` : name };
    if (!hole) continue;
    if (m.index! > last) parts.push(value.slice(last, m.index));
    parts.push(hole);
    last = m.index! + whole.length;
    holes++;
  }
  if (!holes) return null;
  if (last < value.length) parts.push(value.slice(last));
  return parts;
}

/** The signal names a string's holes read (values, `query.column` cells, built-ins), deduped, in order. */
export function templateSignals(value: unknown): string[] {
  const parts = parseTemplate(value);
  return parts ? [...new Set(parts.flatMap((p) => (typeof p !== 'string' && p.kind === 'signal' ? [p.name] : [])))] : [];
}

/** True when a string reads the page (a value or a cell), not only its row. */
export const hasValueHole = (value: unknown): boolean => templateSignals(value).length > 0;

/** True when any string leaf of a JSON value reads the page. */
export function deepHasValueHole(value: unknown, depth = 0): boolean {
  if (depth > 64) return false;
  if (typeof value === 'string') return hasValueHole(value);
  if (Array.isArray(value)) return value.some((v) => deepHasValueHole(v, depth + 1));
  if (value && typeof value === 'object') return Object.values(value).some((v) => deepHasValueHole(v, depth + 1));
  return false;
}

/** Every signal any string leaf reads. */
export function deepTemplateSignals(value: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 64) return out;
  if (typeof value === 'string') { for (const name of templateSignals(value)) if (!out.includes(name)) out.push(name); }
  else if (Array.isArray(value)) value.forEach((v) => deepTemplateSignals(v, out, depth + 1));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => deepTemplateSignals(v, out, depth + 1));
  return out;
}

/**
 * WHERE A TEMPLATE IS READ. `substitute`: the string is filled for the reader. `refuse`: publish names the
 * position, because a value there would change an element's identity (`id`), run or frame something
 * (`on*`, an `<iframe src>`), or a structure the compiler fixes once (an icon's glyph, a grid's geometry, a
 * table's key, a binding's target). `literal`: the string is not markup the reader sees — a declaration, a
 * Mermaid diagram's code, a script component's data — and stays exactly as written.
 */
export type TemplatePosition = 'substitute' | 'refuse' | 'literal';
const DECLARATION_TAGS: ReadonlySet<string> = /* @__PURE__ */ new Set(['Helmet', 'Value', 'Query', 'Mutation', 'Import', 'Notify', 'Context']);
/** Kit props that bind a declared name (`value="$x"`, `data="$q"`, `run="$m"`): a template is never a binding. */
const BINDING_PROPS: ReadonlySet<string> = /* @__PURE__ */ new Set(['data', 'value', 'checked', 'options', 'run', 'set', 'args', 'busy', 'open', 'userId', 'spread', 'dataset']);
/** Kit props that pick a recipe's classes when the page is published (lib/islands RECIPES). */
const RECIPE_PROPS: ReadonlySet<string> = /* @__PURE__ */ new Set(['variant', 'size', 'orientation']);
/** Kit props the compiler reads once: a glyph, a key, a column, an aggregate, a repeat. */
const COMPILED_PROPS: Readonly<Record<string, ReadonlySet<string>>> = {
  Icon: /* @__PURE__ */ new Set(['name']), Column: /* @__PURE__ */ new Set(['col']), DataTable: /* @__PURE__ */ new Set(['rowKey']), Cell: /* @__PURE__ */ new Set(['col', 'agg', 'format']),
  For: /* @__PURE__ */ new Set(['keyBy', 'each']), Mermaid: /* @__PURE__ */ new Set(['colorMode']),
};
/** Compile-time layout macros and static prose regions: no prop of theirs is read at run time. */
const COMPILED_TAGS: ReadonlySet<string> = /* @__PURE__ */ new Set(['Grid', 'GridItem', 'Markdown']);
const HTML_BINDINGS: Readonly<Record<string, ReadonlySet<string>>> = {
  input: /* @__PURE__ */ new Set(['value', 'checked', 'run']), textarea: /* @__PURE__ */ new Set(['value', 'run']), select: /* @__PURE__ */ new Set(['value', 'options', 'run']),
};

export function templatePosition(tag: string, attr: string, isComponent: boolean, script = false): TemplatePosition {
  const lower = attr.toLowerCase();
  if (isComponent && (DECLARATION_TAGS.has(tag) || script || (tag === 'Mermaid' && attr === 'code'))) return 'literal';
  if (lower === 'id' || lower === 'key' || lower === 'ref' || /^on/.test(lower)) return 'refuse';
  if (isComponent) {
    if (COMPILED_TAGS.has(tag) || BINDING_PROPS.has(attr) || RECIPE_PROPS.has(attr) || COMPILED_PROPS[tag]?.has(attr)) return 'refuse';
    return 'substitute';
  }
  const t = tag.toLowerCase();
  // An image's source is the image door's own template (lib/dataflow TEMPLATE_REF_ATTRS, kit/image BoundImage).
  if (t === 'img' && lower === 'src') return 'literal';
  if (t === 'iframe' && lower === 'src') return 'refuse';
  if (HTML_BINDINGS[t]?.has(lower)) return 'refuse';
  return 'substitute';
}

/** The object props whose string leaves are read: a `style` object, a chart's spec and a table's column specs. */
export const isTemplatedObjectProp = (tag: string, attr: string, isComponent: boolean): boolean =>
  attr === 'style' || (isComponent && ((tag === 'Chart' && attr === 'viz') || (tag === 'DataTable' && attr === 'columns')));

/** The page names one authored attribute value reads where it is substituted (values, cells, built-ins). */
export function attributeSignals(tag: string, attr: string, isComponent: boolean, json: unknown, script = false): string[] {
  if (!substitutes(tag, attr, isComponent, script)) return [];
  if (typeof json === 'string') return templateSignals(json);
  return isTemplatedObjectProp(tag, attr, isComponent) ? deepTemplateSignals(json) : [];
}

/** The key a resolved `style` is spread under: set as an attribute, never through the CSSOM, so hydration keeps the served bytes. */
export const STYLE_ATTR_KEY = 'attr:style';

/** True where a template is filled for the reader (`templatePosition` is `substitute`). */
const substitutes = (tag: string, attr: string, isComponent: boolean, script = false): boolean =>
  templatePosition(tag, attr, isComponent, script) === 'substitute';

/** Why a position refuses a template, for the publish error. */
export function templateRefusal(tag: string, attr: string, isComponent: boolean): string {
  const lower = attr.toLowerCase();
  if (lower === 'id' || lower === 'key' || lower === 'ref') return `"${attr}" is the element's identity`;
  if (/^on/.test(lower)) return 'handlers are never markup';
  if (!isComponent && tag.toLowerCase() === 'iframe') return 'a frame loads exactly the https page written';
  if (isComponent && COMPILED_TAGS.has(tag)) return `<${tag}> is laid out when the page is published`;
  if (BINDING_PROPS.has(attr) || HTML_BINDINGS[tag.toLowerCase()]?.has(lower)) return `"${attr}" binds a declared name: write "$name"`;
  return `<${tag} ${attr}> is read when the page is published`;
}

/** What a hole reads now. */
export type HoleReader = (hole: TemplateHole) => unknown;

type Scalar = string | number | boolean | null;
const scalarOf = (value: unknown): Scalar => value === null || typeof value === 'string' || typeof value === 'boolean'
  || (typeof value === 'number' && Number.isFinite(value)) ? value as Scalar : null;
const own = (record: Record<string, unknown> | null | undefined, name: string): Scalar =>
  record && Object.hasOwn(record, name) ? scalarOf(record[name]) : null;

/** A reader over a snapshot: `signals` answers names (values, cells, built-ins) as own properties, `row` its fields. */
export const holeReader = (signals: Record<string, unknown>, row?: Record<string, unknown> | null): HoleReader =>
  (hole) => (hole.kind === 'row' ? own(row, hole.field) : own(signals, hole.name));

export const holeText = (value: unknown): string => {
  const v = scalarOf(value);
  return v === null ? '' : String(v);
};

/** A templated string as text: every hole's value, an absent one as nothing. */
export function resolveTemplate(parts: readonly TemplatePart[], read: HoleReader): string {
  return parts.map((p) => (typeof p === 'string' ? p : holeText(read(p)))).join('');
}

/** A string with its holes filled, or the string itself when it has none. */
export function fillTemplate(value: string, read: HoleReader): string {
  const parts = parseTemplate(value);
  return parts ? resolveTemplate(parts, read) : value;
}

/**
 * Where a chart spec's string is a Vega EXPRESSION (`"filter": "datum.lang === {$lang}"`): a hole there is
 * inserted as a literal of its type — a string quoted (`"rust"`), a number or boolean as written, nothing as
 * `null` — so a value is always data, never expression syntax.
 */
const VIZ_EXPRESSION_KEYS: ReadonlySet<string> = /* @__PURE__ */ new Set(['filter', 'calculate', 'test', 'expr', 'signal', 'update', 'init', 'labelExpr']);

const literal = (value: unknown): string => {
  const v = scalarOf(value);
  return typeof v === 'string' ? JSON.stringify(v) : v === null ? 'null' : String(v);
};

/**
 * A chart's `viz` with every string leaf's holes filled. A leaf that is exactly one hole takes the value's
 * own type (`"{$max}"` → 40); expression leaves (`VIZ_EXPRESSION_KEYS`) take literals; other leaves take text.
 * Keys are never templated. Returns the input itself when nothing in it is templated.
 */
export function substituteViz<T>(viz: T, read: HoleReader): T {
  const visit = (value: unknown, key: string | null, depth: number): unknown => {
    if (depth > 64) return value;
    if (typeof value === 'string') {
      const parts = parseTemplate(value);
      if (!parts) return value;
      if (key !== null && VIZ_EXPRESSION_KEYS.has(key)) return parts.map((p) => (typeof p === 'string' ? p : literal(read(p)))).join('');
      if (parts.length === 1 && typeof parts[0] !== 'string') return scalarOf(read(parts[0]!));
      return resolveTemplate(parts, read);
    }
    if (Array.isArray(value)) return value.map((v) => visit(v, key, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, visit(v, k, depth + 1)]));
    return value;
  };
  return deepHasValueHole(viz) || JSON.stringify(viz ?? null).includes('$_row.') ? visit(viz, null, 0) as T : viz;
}

export { specDigest } from './spec-digest';

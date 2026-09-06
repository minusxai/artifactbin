/**
 * The document's DATAFLOW — the pure contract behind `$name` references.
 *
 * A markup document declares its data in `<Helmet>`:
 *   <Value name="region" type="string" />                    scalar, bound to inputs
 *   <Value name="tiny" type="table" value={[{a:1}]} />      inline table
 *   <Query name="sales">{`select … from ref_abc123 where $region is null or region = $region`}</Query>
 * and refers to it everywhere else by NAME: `data="$sales"` on an embed,
 * `value="$region"` on a native control, `options="$regions"` on a select,
 * `$region` inside SQL (a bound parameter, never interpolated), and a bare
 * `sales` inside another query's SQL (a table). One namespace; the kind of a
 * name (scalar vs table) comes from its declaration, and every reference is
 * checked against it at publish — a typo'd `$sale` is a 400 naming the token,
 * never an embed that silently renders empty.
 *
 * This module is PURE (no DB, no engine, no React) and is the ONLY place that
 * knows the reference syntax: helmet.ts calls
 * `parseValueDecl`/`parseQueryDecl`/`parseMutationDecl` for the three Helmet
 * data children, jsx-tier.ts calls `validateDataflow` in its
 * always-run error array (so /api/preview and publish agree), refs.ts asks
 * `datasetRefsInSql` for the datasets a query reads, and the runtime + engine
 * consume the same `Dataflow`/`DataflowState` shapes off the JSON island.
 *
 * Reference grammar (deliberately narrow — the string stays inert data):
 *  - an attribute reference is the WHOLE value, `^\$[A-Za-z_]\w*$`, so
 *    `fmt="$,.0f"` and a literal "$5" are never mistaken for one;
 *  - it is only read from the attributes in REF_ATTRS (below); anywhere else
 *    a `$…` string is a literal;
 *  - inside SQL, `$name` is a parameter naming a SCALAR value; a table (query
 *    or table-Value) is referenced by its bare name, like any table;
 *  - a dataset artifact is the table `ref_<id>` — collected here so
 *    `meta.refs` (dependents, ownership checks) keeps working.
 */
import type { JsonValue, JsxAttribute, JsxElement, JsxNode, ValidationError } from '@/lib/jsx';
import { inferColumns, type ColumnType, type DatasetColumn } from './dataset-shape';
import { localWriteTarget, SIGNALS_TABLE } from './local-target';
import { reactiveNames, type ReactiveExpression } from '@/lib/jsx/reactive';

// ── declarations ────────────────────────────────────────────────────────────

export const VALUE_TAG = 'Value';
export const QUERY_TAG = 'Query';
/**
 * `<Mutation name>{`insert into ref_<id> … values ($a)`}</Mutation>` — a
 * Query that WRITES. Same SQL dialect, same `$param` binding, same
 * `ref_<id>` table naming; the differences are exactly three: the statement
 * is INSERT/UPDATE/DELETE (judged by type, lib/sql/engine write mode), it
 * names exactly ONE dataset (the one it writes), and it runs on demand — from
 * `<Button run="$name">` or `mx.mutate(name)` — never at render.
 */
export const MUTATION_TAG = 'Mutation';

/** `<Value type>`: the four dataset column types, plus an inline table. */
export type ValueType = ColumnType | 'table';
const VALUE_TYPES: readonly ValueType[] = ['string', 'number', 'boolean', 'date', 'table'];

/** What a scalar Value holds at runtime (and what a SQL `$param` binds to). */
export type Scalar = string | number | boolean | null;
/** One flat row — the same shape datasets, ingest and embeds already speak. */
export type Row = Record<string, unknown>;

interface Span { start: number; end: number }

export interface ScalarValueDecl extends Span {
  kind: 'scalar';
  name: string;
  type: ColumnType;
  /** Initial value; `null` when the author gave no `default`. */
  default: Scalar;
}

export interface TableValueDecl extends Span {
  kind: 'table';
  name: string;
  rows: Row[];
  /** Declared `columns` win over inference, exactly as at the dataset door. */
  columns: DatasetColumn[];
}

export type ValueDecl = ScalarValueDecl | TableValueDecl;

export interface QueryDecl extends Span {
  name: string;
  sql: string;
  /** `$name` parameters the SQL mentions, in first-appearance order (deduped). */
  params: string[];
  /** Dataset artifact ids the SQL reads as `ref_<id>` tables (deduped). */
  refs: string[];
}

export interface MutationDecl extends Span {
  /** Absent = persistent dataset (existing documents); local targets never enter the ref graph. */
  scope?: 'local';
  name: string;
  sql: string;
  /** `$name` parameters the SQL mentions, in first-appearance order (deduped). */
  params: string[];
  /** The ONE dataset artifact id this statement writes (`ref_<id>`). */
  target: string;
  /** Same as `[target]` — the shape the ref graph reads (lib/story/refs). */
  refs: string[];
  /** Optional affected-row guard, enforced by the mutation engine before persistence. */
  expectedAffected?: number;
}

/** Everything a document declares — the parsed `<Helmet>` data children. */
export interface Dataflow {
  values: ValueDecl[];
  queries: QueryDecl[];
  /** `<Mutation>` declarations in authored order. Absent = none (the common case; keeps the island small). */
  mutations?: MutationDecl[];
}

export const EMPTY_DATAFLOW: Dataflow = { values: [], queries: [] };

/** The mutations a flow declares, absent read as none. */
export const mutationsOf = (flow: Dataflow): MutationDecl[] => flow.mutations ?? [];

// ── runtime state (what the island carries and the store holds) ─────────────

/** A materialised table: a query's result or a table-Value's rows. */
export interface TableResult {
  rows: Row[];
  columns: DatasetColumn[];
  /** Present only when the result was cut at the row cap. */
  truncated?: boolean;
  /** The real row count when known (before the cap). */
  totalRows?: number;
}

/**
 * The document's data at one instant: every scalar's current value and every
 * table's current rows, keyed by declared name. Built server-side at render
 * (defaults + a fresh run of every query) and thereafter owned by the runtime
 * store, which re-runs the queries a changed value feeds.
 */
export interface DataflowState {
  /** Per-viewer mutation availability: null permits, a message explains refusal. Missing means not yet checked. */
  mutationAccess?: Record<string, string | null>;
  values: Record<string, Scalar>;
  tables: Record<string, TableResult>;
  /** Queries that did not run, by name → the engine's message (shown in place of the embed). */
  errors: Record<string, string>;
}

// ── the reference syntax ────────────────────────────────────────────────────

/** A whole-attribute reference: `$sales`. */
const REF_NAME_RE = /^\$([A-Za-z_]\w*)$/;
/** A SQL parameter: `$region` (not `$$…` dollar-quoting, not `$1`). */
const SQL_PARAM_RE = /(?<![\w$])\$([A-Za-z_]\w*)/g;
/** A dataset table inside SQL: `ref_<id>` (ids are 6–12 alnum, lib/ids.ts). */
const SQL_DATASET_REF_RE = /(?<![\w$.])ref_([A-Za-z0-9]{6,12})\b/g;
/** A declared name: an identifier that is not shaped like a dataset table. */
export const DECL_NAME_RE = /^[A-Za-z_]\w*$/;

/** `"$sales"` → `"sales"`; anything else → null. */
export function refName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = REF_NAME_RE.exec(value);
  return m ? m[1] : null;
}

/**
 * A reference INSIDE a string: `https://cdn.x.com/{$pick}.png`.
 *
 * The whole-attribute rule above is the general one and stays the general one —
 * it is what keeps `fmt="$,.0f"` and a literal "$5" from ever being read as a
 * reference. This second, BRACED form exists for exactly ONE position (an
 * image's `src`, TEMPLATE_REF_ATTRS below), because an image URL is the one
 * value an author routinely composes rather than picks: a base path plus a key
 * out of the data. The braces are what make it unambiguous — a bare `$pick` in
 * the middle of a URL is a path segment as often as it is a reference.
 */
const TEMPLATE_REF_RE = /\{\s*\$([A-Za-z_]\w*)\s*\}/g;

/** Every `{$name}` in a value, deduped, in order; empty for anything else. */
export function templateRefNames(value: unknown): string[] {
  if (typeof value !== 'string') return [];
  return [...new Set([...value.matchAll(TEMPLATE_REF_RE)].map((m) => m[1]))];
}

/**
 * Does this attribute value carry a reference at all — whole-attribute or
 * braced? The publish door asks it to tell a BINDING from an external URL
 * (lib/story/refs.ts), and the importer asks it to tell a literal URL it can
 * fetch now from a template only the browser can ever complete.
 */
export const carriesRef = (value: unknown): boolean =>
  refName(value) !== null || templateRefNames(value).length > 0;

/**
 * A bound source resolved against the document's values: the whole-attribute
 * form yields the value itself, the braced form the string with every reference
 * substituted. Null when a referenced value is absent, null or empty — a URL
 * with a hole in it is not a URL, and the renderer draws the alt text instead.
 *
 * Pure, and shared by the runtime and its own server-side render: the two must
 * agree byte for byte or React discards the whole server tree (#418).
 */
export function resolveRefTemplate(value: string, get: (name: string) => Scalar | undefined): string | null {
  const whole = refName(value);
  if (whole !== null) {
    const v = get(whole);
    return v === null || v === undefined || v === '' ? null : String(v);
  }
  if (templateRefNames(value).length === 0) return value;
  let missing = false;
  const out = value.replace(TEMPLATE_REF_RE, (_all, name: string) => {
    const v = get(name);
    if (v === null || v === undefined || v === '') { missing = true; return ''; }
    return String(v);
  });
  return missing ? null : out;
}

/**
 * A control's string input coerced to the bound Value's declared type —
 * shared by every two-way binding (the native bound controls and the kit
 * control components), so a slider yields a number, a switch a boolean, and
 * the empty string is null (which is how `$x is null` in SQL means "all").
 */
export function coerceScalarInput(type: ValueType | undefined, raw: string): Scalar {
  if (raw === '') return null;
  if (type === 'number') { const n = Number(raw); return Number.isFinite(n) ? n : null; }
  if (type === 'boolean') return raw === 'true';
  return raw;
}

/** What a reference position expects: a table, a scalar, or (on `run=`) a mutation. */
export type RefKind = 'table' | 'scalar' | 'mutation';

/**
 * Where a `$name` is READ, and what kind it must name. Components are matched
 * by exact tag, HTML tags case-insensitively. Anywhere else `$…` is a literal.
 */
export const REF_ATTRS: {
  components: Record<string, Record<string, RefKind>>;
  html: Record<string, Record<string, RefKind>>;
} = {
  components: {
    Question: { data: 'table' },
    Number: { data: 'table' },
    DataTable: { data: 'table' },
    // A folder's listing, bound to the children table its <Query> reads.
    Files: { data: 'table' },
    // The kit CONTROL components (components/kit/controls.tsx): the same
    // two-way scalar bindings the native controls carry, in themed chrome.
    // `options` is a table exactly like `<select options>` (column 1 the
    // value, column 2 the label when present).
    Select: { value: 'scalar', options: 'table', run: 'mutation' },
    Slider: { value: 'scalar' },
    DatePicker: { value: 'scalar' },
    Segmented: { value: 'scalar', options: 'table' },
    Switch: { checked: 'scalar' },
    // The one TRIGGER position: a kit <Button run="$name"> runs the named
    // <Mutation> with the document's current values (components/kit/button
    // static face; lib/story-runtime/StoryRuntimeApp live face).
    Button: { run: 'mutation' },
    Dialog: {open: 'scalar'},
    DialogContent: {run: 'mutation'},
  },
  html: {
    input: { value: 'scalar', checked: 'scalar', run: 'mutation' },
    textarea: { value: 'scalar', run: 'mutation' },
    select: { value: 'scalar', options: 'table', run: 'mutation' },
    /*
     * `<img src="$pick">` — a BOUND SOURCE, and the one reference position that
     * is not a form control. It is read exactly like every other scalar
     * reference (declared, of the right kind, or a named refusal at publish);
     * what differs is what happens with the value, which is a URL rather than a
     * number: whatever the browser ends up with is mapped to our own copy
     * (lib/story/asset-url runtimeAssetUrl) and imported on first view by the
     * document's own asset endpoint, because publish cannot see a URL that does
     * not exist until a reader picks it.
     */
    img: { src: 'scalar' },
  },
};

/**
 * Where a `$name` may sit INSIDE a string rather than being the whole
 * attribute — the braced form, `src="https://cdn.x.com/{$pick}.png"`.
 *
 * Exactly one position, deliberately. Widening this is how `fmt="$,.0f"`
 * becomes a reference to a value called `,` — the whole-attribute rule is the
 * general one and this is the single, named exception, for the single value an
 * author composes instead of picking.
 */
export const TEMPLATE_REF_ATTRS: {
  components: Record<string, ReadonlySet<string>>;
  html: Record<string, ReadonlySet<string>>;
} = {
  components: {},
  html: { img: new Set(['src']) },
};

/** True where the braced form is read at all — everywhere else `{$x}` is text. */
export const isTemplateRefPosition = (tag: string, attr: string, isComponent: boolean): boolean =>
  !!(isComponent ? TEMPLATE_REF_ATTRS.components[tag] : TEMPLATE_REF_ATTRS.html[tag.toLowerCase()])
    ?.has(isComponent ? attr : attr.toLowerCase());

/** One `$name` occurrence in the body. */
export interface RefNameUse extends Span {
  name: string;
  tag: string;
  attr: string;
  expects: RefKind;
}

// ── parsing the two Helmet children ─────────────────────────────────────────

export type ParseDeclResult<T> = { ok: true; decl: T } | { ok: false; errors: ValidationError[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

const err = (message: string, span: Span, tag: string, attr?: string): ValidationError =>
  ({ message, tag, start: span.start, end: span.end, ...(attr ? { attr } : {}) });

/** Static JSON of an attribute, or `undefined` when absent / non-static. */
const staticAttr = (el: JsxElement, name: string): { attr: JsxAttribute; json: JsonValue } | { attr: JsxAttribute; json?: undefined } | undefined => {
  const attr = el.attributes.find((a) => a.name === name);
  if (!attr) return undefined;
  return attr.value.static ? { attr, json: attr.value.json } : { attr };
};

/**
 * `name` on either declaration: an identifier that is not shaped like a
 * dataset table (`ref_<id>` is how SQL names those, and a Value called
 * `ref_abc123` would shadow one).
 */
function checkName(el: JsxElement, tag: string, errors: ValidationError[]): string | null {
  const got = staticAttr(el, 'name');
  if (!got) { errors.push(err(`<${tag}> needs a name attribute`, el, tag, 'name')); return null; }
  if (typeof got.json !== 'string' || !DECL_NAME_RE.test(got.json)) {
    errors.push(err(`<${tag}> name must be an identifier ([A-Za-z_][A-Za-z0-9_]*), got ${JSON.stringify(got.json ?? got.attr.value)}`, got.attr, tag, 'name'));
    return null;
  }
  if (got.json.startsWith('ref_')) {
    errors.push(err(`<${tag}> name "${got.json}" is reserved — ref_<id> names a dataset table inside SQL`, got.attr, tag, 'name'));
    return null;
  }
  if (got.json.startsWith('_')) {
    errors.push(err(`<${tag}> name "${got.json}" is reserved — names beginning with _ belong to the row runtime`, got.attr, tag, 'name'));
    return null;
  }
  return got.json;
}

/**
 * Does a value match a declared scalar type? The predicate the publish door
 * uses for `<Value default>`, EXPORTED because a URL-carried selection has to
 * be judged by exactly the same rule (lib/story/url-values) — a link that
 * would be refused as a default must not become a document's state.
 */
export const scalarMatches = (v: unknown, t: ColumnType): boolean => {
  if (v === null) return true;
  switch (t) {
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'boolean': return typeof v === 'boolean';
    case 'date': return typeof v === 'string' && DATE_RE.test(v);
    case 'string': return typeof v === 'string';
  }
};

const VALUE_ATTRS = new Set(['name', 'type', 'default', 'value', 'columns']);

/**
 * `<Value name type default? value? columns? />` → a declaration, or the
 * precise errors. Attributes: `name` (identifier), `type` (VALUE_TYPES,
 * default "string"), `default` (scalar matching the type; dates are ISO
 * strings), `value` (table rows — required for and only for type "table"),
 * `columns` (`[{name, type}]`, table only). Anything else is rejected by name.
 */
export function parseValueDecl(el: JsxElement): ParseDeclResult<ValueDecl> {
  const tag = VALUE_TAG;
  const errors: ValidationError[] = [];
  for (const a of el.attributes) {
    if (!VALUE_ATTRS.has(a.name)) errors.push(err(`<Value> takes name, type, default, value, columns — not "${a.name}"`, a, tag, a.name));
    else if (!a.value.static) errors.push(err(`<Value> attribute "${a.name}" must be a JSON literal, got ${a.value.exprType}`, a, tag, a.name));
  }
  if (errors.length) return { ok: false, errors };
  const name = checkName(el, tag, errors);
  if (!name) return { ok: false, errors };

  const typeAttr = staticAttr(el, 'type');
  const type = (typeAttr?.json ?? 'string') as ValueType;
  if (!VALUE_TYPES.includes(type)) {
    return { ok: false, errors: [err(`<Value name="${name}"> type must be one of ${VALUE_TYPES.join(' | ')}, got ${JSON.stringify(typeAttr?.json)}`, typeAttr?.attr ?? el, tag, 'type')] };
  }
  const def = staticAttr(el, 'default');
  const val = staticAttr(el, 'value');
  const cols = staticAttr(el, 'columns');

  if (type === 'table') {
    if (def) errors.push(err(`<Value name="${name}" type="table"> holds its rows in value=, not default=`, def.attr, tag, 'default'));
    if (!val) return { ok: false, errors: [...errors, err(`<Value name="${name}" type="table"> needs value={[{…}, …]} — a non-empty array of flat objects`, el, tag, 'value')] };
    const rows = val.json;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { ok: false, errors: [...errors, err(`<Value name="${name}"> value must be a non-empty array of flat objects`, val.attr, tag, 'value')] };
    }
    for (const [i, row] of rows.entries()) {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        errors.push(err(`<Value name="${name}"> value row ${i} is not an object — rows are flat objects`, val.attr, tag, 'value'));
        continue;
      }
      for (const [k, v] of Object.entries(row)) {
        if (v !== null && typeof v === 'object') errors.push(err(`<Value name="${name}"> value row ${i} column "${k}" is nested — rows are flat objects`, val.attr, tag, 'value'));
      }
    }
    if (errors.length) return { ok: false, errors };
    const flat = rows as Row[];
    let columns = inferColumns(flat);
    if (cols) {
      const declared = cols.json;
      const okShape = Array.isArray(declared) && declared.every((c) => c && typeof c === 'object' && !Array.isArray(c)
        && typeof (c as { name?: unknown }).name === 'string' && (VALUE_TYPES as readonly string[]).includes((c as { type?: string }).type ?? '') && (c as { type?: string }).type !== 'table');
      if (!okShape) return { ok: false, errors: [err(`<Value name="${name}"> columns must be [{name, type: string|number|boolean|date}]`, cols.attr, tag, 'columns')] };
      const declaredCols = declared as unknown as DatasetColumn[];
      const names = new Set(declaredCols.map((c) => c.name));
      columns = [...declaredCols, ...columns.filter((c) => !names.has(c.name))];
    }
    return { ok: true, decl: { kind: 'table', name, rows: flat, columns, start: el.start, end: el.end } };
  }

  if (val) errors.push(err(`<Value name="${name}"> value= is for type="table" rows; a scalar's initial value is default=`, val.attr, tag, 'value'));
  if (cols) errors.push(err(`<Value name="${name}"> columns= is for type="table"`, cols.attr, tag, 'columns'));
  const dflt = (def?.json ?? null) as Scalar;
  if (def && !scalarMatches(dflt, type)) {
    errors.push(err(`<Value name="${name}" type="${type}"> default ${JSON.stringify(dflt)} is not a ${type}${type === 'date' ? ' (use YYYY-MM-DD)' : ''}`, def.attr, tag, 'default'));
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, decl: { kind: 'scalar', name, type, default: dflt, start: el.start, end: el.end } };
}

/**
 * `<Query name>{`sql`}</Query>` → a declaration with its params and dataset
 * refs, or the errors: `name` is the only attribute; the single child is a
 * template literal (SQL keeps `<`, `>` and braces raw that way — the same rule
 * as `<style>`); the SQL is non-empty.
 */
export function parseQueryDecl(el: JsxElement): ParseDeclResult<QueryDecl> {
  const tag = QUERY_TAG;
  const errors: ValidationError[] = [];
  for (const a of el.attributes) {
    if (a.name !== 'name') errors.push(err(`<Query> takes only name= — the SQL is its child: <Query name="…">{\`select …\`}</Query>${a.name === 'sql' ? ' (not a sql= attribute)' : ''}`, a, tag, a.name));
  }
  if (errors.length) return { ok: false, errors };
  const name = checkName(el, tag, errors);
  if (!name) return { ok: false, errors };
  const kids = el.children.filter((c) => !(c.type === 'text' && c.value.trim() === ''));
  const kid = kids.length === 1 ? kids[0] : null;
  const sql = kid && kid.type === 'expression' && kid.value.static && typeof kid.value.json === 'string' ? kid.value.json : null;
  if (sql === null) {
    return { ok: false, errors: [err(`<Query name="${name}"> holds a single template-literal child with the SQL: <Query name="${name}">{\`select …\`}</Query>`, el, tag)] };
  }
  if (sql.trim() === '') return { ok: false, errors: [err(`<Query name="${name}"> has empty SQL`, el, tag)] };
  return { ok: true, decl: { name, sql, params: sqlParams(sql), refs: datasetRefsInSql(sql), start: el.start, end: el.end } };
}

/**
 * `<Mutation name>{`sql`}</Mutation>` → a declaration, or the errors. The
 * Query rules (name only, one template-literal child, non-empty) plus one of
 * its own: the SQL names exactly ONE `ref_<id>` — the dataset it writes. A
 * statement that names two would either read a second dataset into the
 * first (the engine registers only the target, so it would fail at run
 * time anyway) or be ambiguous about which one is being written, and a
 * write must never be ambiguous.
 */
export function parseMutationDecl(el: JsxElement): ParseDeclResult<MutationDecl> {
  const tag = MUTATION_TAG;
  const errors: ValidationError[] = [];
  for (const a of el.attributes) {
    if (a.name !== 'name' && a.name !== 'expectedAffected') errors.push(err(`<Mutation> takes only name= and expectedAffected= — the SQL is its child: <Mutation name="…">{\`insert into ref_<id> …\`}</Mutation>${a.name === 'sql' ? ' (not a sql= attribute)' : ''}`, a, tag, a.name));
  }
  if (errors.length) return { ok: false, errors };
  const name = checkName(el, tag, errors);
  if (!name) return { ok: false, errors };
  const kids = el.children.filter((c) => !(c.type === 'text' && c.value.trim() === ''));
  const kid = kids.length === 1 ? kids[0] : null;
  const sql = kid && kid.type === 'expression' && kid.value.static && typeof kid.value.json === 'string' ? kid.value.json : null;
  if (sql === null) {
    return { ok: false, errors: [err(`<Mutation name="${name}"> holds a single template-literal child with the SQL: <Mutation name="${name}">{\`insert into ref_<id> …\`}</Mutation>`, el, tag)] };
  }
  if (sql.trim() === '') return { ok: false, errors: [err(`<Mutation name="${name}"> has empty SQL`, el, tag)] };
  const refs = datasetRefsInSql(sql);
  const direct = localWriteTarget(sql);
  const local = direct && !direct.name.startsWith('ref_');
  if (local && refs.length) {
    return { ok: false, errors: [err('A local mutation cannot mix local and persistent dataset tables', el, tag)] };
  }
  if (local && direct.name === SIGNALS_TABLE && direct.operation !== 'update') {
    return { ok: false, errors: [err('_signals allows only UPDATE; it must remain a single row', el, tag)] };
  }
  if (!local && refs.length !== 1) {
    return { ok: false, errors: [err(`<Mutation name="${name}"> must write exactly one dataset table (ref_<id>) — found ${refs.length === 0 ? 'none' : refs.map((r) => `ref_${r}`).join(', ')}`, el, tag)] };
  }
  const expected = staticAttr(el, 'expectedAffected');
  if (expected && (typeof expected.json !== 'number' || !Number.isInteger(expected.json) || expected.json < 0)) {
    return { ok: false, errors: [err(`<Mutation expectedAffected> must be a non-negative integer`, expected.attr, tag, 'expectedAffected')] };
  }
  return { ok: true, decl: { name, sql, params: sqlParams(sql), target: local ? direct.name : refs[0], refs, ...(local ? {scope: 'local' as const} : {}), ...(expected ? { expectedAffected: expected.json as number } : {}), start: el.start, end: el.end } };
}

// ── the reference graph ─────────────────────────────────────────────────────

/** Every `$name` reference in the BODY, from the REF_ATTRS positions only. */
export function collectRefNameUses(body: JsxNode[]): RefNameUse[] {
  const out: RefNameUse[] = [];
  const expressionUses = (expression: ReactiveExpression | undefined, span: Span, tag: string, attr: string) => {
    if (expression) for (const name of reactiveNames(expression).signals) out.push({name, tag, attr, expects: 'scalar', start: span.start, end: span.end});
  };
  const visit = (nodes: JsxNode[]) => {
    for (const n of nodes) {
      if (n.type === 'expression' && !n.value.static) expressionUses(n.value.reactive, n, 'expression', 'value');
      if (n.type !== 'element') continue;
      if (n.control && n.control.kind !== 'fragment') expressionUses(n.control.test, n, 'condition', 'test');
      for (const a of n.attributes) if (!a.value.static) expressionUses(a.value.reactive, a, n.tag, a.name);
      const table = n.isComponent ? REF_ATTRS.components[n.tag] : REF_ATTRS.html[n.tag.toLowerCase()];
      if (table) {
        for (const a of n.attributes) {
          const expects = table[n.isComponent ? a.name : a.name.toLowerCase()];
          if (!expects || !a.value.static) continue;
          const name = refName(a.value.json);
          if (name) { out.push({ name, tag: n.tag, attr: a.name, expects, start: a.start, end: a.end }); continue; }
          // …and, in the one position that reads it, every `{$name}` inside the
          // string. Same kind, same checks, same refusal — one use per name.
          if (!isTemplateRefPosition(n.tag, a.name, n.isComponent)) continue;
          for (const templated of templateRefNames(a.value.json)) {
            out.push({ name: templated, tag: n.tag, attr: a.name, expects, start: a.start, end: a.end });
          }
        }
      }
      visit(n.children);
    }
  };
  visit(body);
  return out;
}

const dedupe = (xs: string[]): string[] => [...new Set(xs)];

/** Dataset ids a piece of SQL reads (`ref_<id>`), deduped, in order. */
export function datasetRefsInSql(sql: string): string[] {
  return dedupe([...sql.matchAll(SQL_DATASET_REF_RE)].map((m) => m[1]));
}

/** `$name` parameters a piece of SQL binds, deduped, in order. */
export function sqlParams(sql: string): string[] {
  return dedupe([...sql.matchAll(SQL_PARAM_RE)].map((m) => m[1]));
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The declared TABLE names (queries + table-Values) a query's SQL mentions as
 * bare identifiers — its dependencies. Text-level on purpose (a name inside a
 * string literal counts): a false dependency only affects ordering, and the
 * engine's own binder is the authority on what the SQL really reads.
 */
export function queryDeps(sql: string, tableNames: Iterable<string>): string[] {
  const out: string[] = [];
  for (const name of tableNames) {
    if (new RegExp(`(?<![\\w$.])${escapeRe(name)}(?![\\w])`).test(sql)) out.push(name);
  }
  return out;
}

const tableNamesOf = (flow: Dataflow): string[] => [
  ...flow.values.filter((v) => v.kind === 'table').map((v) => v.name),
  ...flow.queries.map((q) => q.name),
];

/** deps per query, restricted to declared table names. */
const depGraph = (flow: Dataflow): Map<string, string[]> => {
  const tables = tableNamesOf(flow);
  const queryNames = new Set(flow.queries.map((q) => q.name));
  return new Map(flow.queries.map((q) => [q.name, queryDeps(q.sql, tables).filter((d) => queryNames.has(d))]));
};

/**
 * Depth-first topological order: visit queries in authored order, emitting
 * each one's dependencies first — so "dependencies first, otherwise authored
 * order" holds exactly. Cyclic queries are reported, not ordered.
 */
function topo(flow: Dataflow): { order: string[]; cyclic: string[] } {
  const graph = depGraph(flow);
  const order: string[] = [];
  const done = new Set<string>();
  const onPath = new Set<string>();
  const cyclic = new Set<string>();
  const visit = (name: string): void => {
    if (done.has(name)) return;
    if (onPath.has(name)) { cyclic.add(name); return; }
    onPath.add(name);
    for (const d of graph.get(name) ?? []) {
      visit(d);
      if (cyclic.has(d) && onPath.has(d)) cyclic.add(name);
    }
    onPath.delete(name);
    done.add(name);
    if (!cyclic.has(name)) order.push(name);
  };
  for (const q of flow.queries) visit(q.name);
  // A query downstream of a cycle is not itself cyclic, but it cannot run either; report only the cycle members.
  return { order: order.filter((n) => !cyclic.has(n)), cyclic: flow.queries.map((q) => q.name).filter((n) => cyclic.has(n)) };
}

/**
 * Publish-time semantics over the whole document. Reports, with spans:
 *  - a name declared twice (across Values and Queries);
 *  - a `$name` reference to nothing declared;
 *  - a reference of the wrong kind (`data="$region"` where region is a scalar,
 *    `value="$sales"` where sales is a table);
 *  - a SQL `$param` that names a table or nothing declared;
 *  - a dependency cycle between queries (a query may not read itself).
 * [] = valid.
 */
export function validateDataflow(flow: Dataflow, uses: RefNameUse[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const kinds = new Map<string, RefKind>();
  const declare = (name: string, kind: RefKind, span: Span, tag: string) => {
    if (kinds.has(name)) {
      errors.push(err(`"${name}" is declared twice in <Helmet> — every <Value>/<Query> name is unique`, span, tag, 'name'));
      return;
    }
    kinds.set(name, kind);
  };
  for (const v of flow.values) declare(v.name, v.kind === 'table' ? 'table' : 'scalar', v, VALUE_TAG);
  for (const q of flow.queries) declare(q.name, 'table', q, QUERY_TAG);
  for (const m of mutationsOf(flow)) declare(m.name, 'mutation', m, MUTATION_TAG);

  const hint = ' — declare it in <Helmet> as <Value name="…" …/> or <Query name="…">{`…`}</Query>';
  const describe = (kind: RefKind): string =>
    kind === 'scalar' ? 'a scalar <Value>' : kind === 'table' ? 'a table' : 'a <Mutation>';
  for (const u of uses) {
    const kind = kinds.get(u.name);
    if (!kind) {
      errors.push(err(`<${u.tag} ${u.attr}="$${u.name}"> refers to nothing declared${u.expects === 'mutation' ? ' — declare it in <Helmet> as <Mutation name="…">{`insert into ref_<id> …`}</Mutation>' : hint}`, u, u.tag, u.attr));
    } else if (kind !== u.expects) {
      errors.push(err(
        u.expects === 'table'
          ? `<${u.tag} ${u.attr}="$${u.name}"> needs a table (a <Query> or a <Value type="table">), but "${u.name}" is ${describe(kind)}`
          : u.expects === 'scalar'
            ? `<${u.tag} ${u.attr}="$${u.name}"> binds a scalar value, but "${u.name}" is ${describe(kind)} — bind a <Value> (string | number | boolean | date)`
            : `<${u.tag} ${u.attr}="$${u.name}"> needs a <Mutation>, but "${u.name}" is ${describe(kind)} — run= names the write a click performs`,
        u, u.tag, u.attr,
      ));
    }
  }

  const checkParams = (decl: { name: string; params: string[] } & Span, tag: string) => {
    for (const p of decl.params) {
      if (tag === MUTATION_TAG && (p === '_row' || p === '_value')) continue;
      const kind = kinds.get(p);
      if (!kind) errors.push(err(`<${tag} name="${decl.name}"> binds $${p}, which is not a declared <Value>${hint}`, decl, tag));
      else if (kind === 'table') errors.push(err(`<${tag} name="${decl.name}"> binds $${p}, but "${p}" is a table — read a table by its bare name (… from ${p} …); $params bind scalar <Value>s`, decl, tag));
      else if (kind === 'mutation') errors.push(err(`<${tag} name="${decl.name}"> binds $${p}, but "${p}" is a <Mutation> — $params bind scalar <Value>s`, decl, tag));
    }
  };
  for (const q of flow.queries) checkParams(q, QUERY_TAG);
  for (const m of mutationsOf(flow)) {
    checkParams(m, MUTATION_TAG);
    if (m.scope === 'local' && m.target !== SIGNALS_TABLE && !flow.values.some(v => v.kind === 'table' && v.name === m.target)) {
      errors.push(err(`Local mutation "${m.name}" must target a declared table Value or _signals`, m, MUTATION_TAG));
    }
  }

  const { cyclic } = topo(flow);
  if (cyclic.length) {
    const self = flow.queries.find((q) => cyclic.length === 1 && q.name === cyclic[0]);
    const anchor = flow.queries.find((q) => q.name === cyclic[0]) ?? flow.queries[0];
    errors.push(err(
      self
        ? `<Query name="${self.name}"> reads itself — a query cannot depend on its own result (cycle)`
        : `queries form a dependency cycle: ${cyclic.join(' → ')} — a query may only read queries that do not read it back`,
      anchor, QUERY_TAG,
    ));
  }
  return errors;
}

/**
 * The order queries must run in (dependencies first), or null on a cycle.
 * Table-Values are inputs, never ordered. Stable: ties keep authored order.
 */
export function queryOrder(flow: Dataflow): string[] | null {
  const { order, cyclic } = topo(flow);
  return cyclic.length ? null : order;
}

/** Every dataset id any query reads, deduped — what `meta.refs` needs. */
export function datasetRefsInDataflow(flow: Dataflow): string[] {
  return dedupe(flow.queries.flatMap((q) => q.refs));
}

/** The initial `values` map: every scalar at its declared default. */
export function initialValues(flow: Dataflow): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  for (const v of flow.values) if (v.kind === 'scalar') out[v.name] = v.default;
  return out;
}

/**
 * The tables a document already HAS: every inline `<Value type="table">`.
 *
 * Their rows are written in the source, so they travel with the declarations
 * and are a fact about the document rather than a result of running anything.
 * The server used to copy them into state while running the dataflow, which
 * hid that — and with paint-first, where nobody runs a dataflow for a reader,
 * a chart bound to an inline table drew nothing at all.
 */
export function initialTables(flow: Dataflow): DataflowState['tables'] {
  const out: DataflowState['tables'] = {};
  for (const v of flow.values) if (v.kind === 'table') out[v.name] = { rows: v.rows, columns: v.columns };
  return out;
}

/** The queries whose SQL binds any of the given value names — what a change re-runs (transitively, in run order). */
export function queriesDependingOn(flow: Dataflow, valueNames: Iterable<string>): string[] {
  const changed = new Set(valueNames);
  const graph = depGraph(flow);
  const order = queryOrder(flow) ?? flow.queries.map((q) => q.name);
  const dirty = new Set<string>();
  for (const name of order) {
    const q = flow.queries.find((x) => x.name === name)!;
    if (q.params.some((p) => changed.has(p))
      || (changed.size > 0 && queryDeps(q.sql, [SIGNALS_TABLE]).length > 0)
      || (graph.get(name) ?? []).some((d) => dirty.has(d))) dirty.add(name);
  }
  return order.filter((n) => dirty.has(n));
}

/**
 * The queries a WRITE to any of these datasets makes stale: every query whose
 * SQL reads one of them as `ref_<id>`, and everything downstream of those —
 * in run order, so a caller can re-run the list as given. The data-side twin
 * of `queriesDependingOn` (which follows a scalar); the runtime store calls
 * it when a `data` frame or its own mutation names a dataset.
 */
export function queriesReadingDatasets(flow: Dataflow, datasetIds: Iterable<string>): string[] {
  const changed = new Set(datasetIds);
  const graph = depGraph(flow);
  const order = queryOrder(flow) ?? flow.queries.map((q) => q.name);
  const dirty = new Set<string>();
  for (const name of order) {
    const q = flow.queries.find((x) => x.name === name)!;
    if (q.refs.some((id) => changed.has(id)) || (graph.get(name) ?? []).some((d) => dirty.has(d))) dirty.add(name);
  }
  return order.filter((n) => dirty.has(n));
}

/** Every dataset id any mutation writes, deduped — the refs a write needs resolved and owned. */
export function mutationTargets(flow: Dataflow): string[] {
  return dedupe(mutationsOf(flow).filter(m => m.scope !== 'local').map((m) => m.target));
}

/** True when the document declares nothing (no Values, no Queries, no Mutations). */
export const isEmptyDataflow = (flow: Dataflow): boolean =>
  flow.values.length === 0 && flow.queries.length === 0 && mutationsOf(flow).length === 0;

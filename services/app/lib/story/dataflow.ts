import {normalizeTimestamp,isTimestamp} from '@artifactbin/utils/shape';
/**
 * The document's DATAFLOW DECLARATIONS — the parsed `<Helmet>` data children
 * and the `$name` reference syntax of the markup around them.
 *
 * A markup document declares its data in `<Helmet>`:
 *   <Import name="bookings" src="ref:abc123" />             a stored dataset (or folder), read as bookings.rows
 *   <Value name="region" type="string" />                    scalar, bound to inputs
 *   <Value name="tiny" type="table" value={[{a:1}]} />      inline table
 *   <Query name="sales">{`select … from bookings.rows where $region is null or region = $region`}</Query>
 *   <Mutation name="book">{`insert into bookings.rows …`}</Mutation>
 * and refers to it everywhere else by NAME: `data="$sales"` on an embed,
 * `value="$region"` on a native control, `options="$regions"` on a select,
 * `run="$book"` on a button. One namespace; the kind of a name comes from its
 * declaration, and every markup reference is checked against it at publish.
 *
 * This module is PURE and knows the MARKUP half only. What the SQL reads,
 * binds and writes is SQLite's own report, taken by the compiler
 * (lib/story/compile-dataflow → CompiledDataflow); nothing here reads SQL text.
 *
 * Reference grammar (deliberately narrow — the string stays inert data):
 *  - an attribute reference is the WHOLE value, `^\$[A-Za-z_]\w*$` (or a
 *    markup built-in field, `$_me.id`), so `fmt="$,.0f"` and a literal "$5"
 *    are never mistaken for one;
 *  - it is only read from the attributes in REF_ATTRS (below); anywhere else
 *    a `$…` string is a literal.
 */
import type { JsonValue, JsxAttribute, JsxElement, JsxNode, ValidationError } from '@/lib/jsx';
import {parseDatasetColumn} from '@artifactbin/utils/shape';
import { inferColumns, type ColumnType, type DatasetColumn } from './dataset-shape';
import { reactiveNames, type ReactiveExpression } from '@/lib/jsx/reactive';
import { ARTIFACT_ID_PATTERN, ARTIFACT_REFERENCE_PATTERN } from '@artifactbin/contracts';
import { builtinInput, READ_ONLY_REF_ATTRS, reservedDeclarationName, VIEWER, VIEWER_ID } from './builtins';

// ── declarations ────────────────────────────────────────────────────────────

/**
 * `<Import name="bookings" src="ref:<id>" />` — a stored table-producing
 * artifact (a dataset, a folder) every query and mutation reads as its own
 * schema: `bookings.rows`, and a catalog dataset's whitelisted tables beside
 * it. A connected Postgres dataset is never imported; its queries run inside
 * it (`<Query source="ref:<id>">`).
 */
export const IMPORT_TAG = 'Import';
export const VALUE_TAG = 'Value';
export const QUERY_TAG = 'Query';
/**
 * `<Mutation name>{`insert into bookings.rows … values ($a)`}</Mutation>` — a
 * statement that WRITES exactly one imported table or one local table Value,
 * on demand — from `<Button run="$name">` or `mx.mutate(name)` — never at
 * render. Its plain `$name` parameters are its arguments.
 */
export const MUTATION_TAG = 'Mutation';

/** `<Value type>`: the dataset column types, plus an inline table. */
type ValueType = ColumnType | 'table';
const VALUE_TYPES: readonly ValueType[] = ['string', 'number', 'boolean', 'date', 'timestamp', 'user', 'table'];

/** What a scalar Value holds at runtime (and what a SQL `$param` binds to). */
export type Scalar = string | number | boolean | null;
/** One flat row — the same shape datasets, ingest and embeds already speak. */
export type Row = Record<string, unknown>;

interface Span { start: number; end: number }

export interface ImportDecl extends Span {
  name: string;
  /** The artifact id `src="ref:<id>"` names. */
  ref: string;
}

export interface ScalarValueDecl extends Span {
  kind: 'scalar';
  name: string;
  type: ColumnType;
  source?: string;
  column?: string;
  constraints?: import("@artifactbin/contracts").UserConstraints;
  /** Initial value; `null` when the author gave no `default`. */
  default: Scalar;
  /** `false` keeps this Value out of the address: never written to it, never read from it. Absent = it travels in the link. */
  url?: false;
}

interface TableValueDecl extends Span {
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
  /** A connected Postgres dataset the query runs inside (`source="ref:<id>"`). */
  source?: string;
}

export interface MutationDecl extends Span {
  name: string;
  sql: string;
  /** Optional affected-row guard, enforced by the mutation engine before persistence. */
  expectedAffected?: number;
  /** Scalar Values set back to their declared defaults after this write succeeds. */
  reset?: string[];
}

/** Everything a document declares — the parsed `<Helmet>` data children, in authored order. */
export interface Dataflow {
  imports: ImportDecl[];
  values: ValueDecl[];
  queries: QueryDecl[];
  mutations: MutationDecl[];
}

export const EMPTY_DATAFLOW: Dataflow = { imports: [], values: [], queries: [], mutations: [] };

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
  userOptions?: Record<string, import('@artifactbin/contracts').UserOption[]>;
  /** The people this document may name, by id (lib/datasets/user-fields people). */
  people?: Record<string,import('@artifactbin/contracts').PersonCard>;
  values: Record<string, Scalar>;
  tables: Record<string, TableResult>;
  /** Queries that did not run, by name → the engine's message (shown in place of the embed). */
  errors: Record<string, string>;
}

// ── the reference syntax ────────────────────────────────────────────────────

/** A whole-attribute reference: `$sales`, or a built-in field (`$_me.id`, `$_row.day`). */
const REF_NAME_RE = /^\$([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)?)$/;
/** A declared name: an identifier. */
export const DECL_NAME_RE = /^[A-Za-z_]\w*$/;

/**
 * `"$sales"` → `"sales"`, `"$_me.id"` → `"_me.id"` (the one dotted name markup
 * binds); anything else → null. A row field (`$_row.day`) is the row scope's,
 * substituted before any binding reads it (lib/story/row-scope).
 */
export function refName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = REF_NAME_RE.exec(value);
  if (!m) return null;
  return !m[1].includes('.') || builtinInput(m[1])?.markup ? m[1] : null;
}

/**
 * WHERE `set=` AND `args=` TAKE A VALUE FROM: a page value (`"$day"`), a
 * built-in (`"$_row.day"`, `"$_me.id"`), or a literal. A string that is
 * shaped like a reference is one; anything else is itself.
 */
export type BindingSource = { ref: string } | { literal: Scalar };

export function bindingSource(json: unknown): BindingSource | null {
  if (typeof json === 'string') { const m = REF_NAME_RE.exec(json); return m ? { ref: m[1] } : { literal: json }; }
  if (json === null || typeof json === 'boolean' || (typeof json === 'number' && Number.isFinite(json))) return { literal: json };
  return null;
}

/** `set={{"day": "$_row.day"}}` / `args={{"when": "$day"}}` → name → source; null when it is not a flat object of sources. */
export function bindingMap(json: unknown): Record<string, BindingSource> | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const out: Record<string, BindingSource> = {};
  for (const [key, value] of Object.entries(json)) {
    const source = bindingSource(value);
    if (!source || !DECL_NAME_RE.test(key)) return null;
    out[key] = source;
  }
  return out;
}

/**
 * A binding map inside a row: every `$_row.<column>` source becomes the row's
 * value, so what reaches the control is already unambiguous (a row value that
 * happens to start with `$` stays a literal).
 */
export function rowBound(map: Record<string, BindingSource>, row: Record<string, unknown>): Record<string, BindingSource> {
  return Object.fromEntries(Object.entries(map).map(([key, source]) => {
    const field = 'ref' in source ? /^_row\.([A-Za-z_]\w*)$/.exec(source.ref)?.[1] : undefined;
    if (field === undefined) return [key, source];
    const value = row[field];
    return [key, { literal: value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) ? value : null }];
  }));
}

/** A binding map's values now: literals as written, references read through `get`. */
export function resolveBindings(map: Record<string, BindingSource>, get: (ref: string) => Scalar | undefined): Record<string, Scalar> {
  return Object.fromEntries(Object.entries(map).map(([key, source]) => [key, 'literal' in source ? source.literal : get(source.ref) ?? null]));
}

/** The attributes that carry a `bindingMap`: `set=` on a Button (no SQL, no server), `args=` beside `run=`. */
export const SET_ATTR = 'set';
export const ARGS_ATTR = 'args';

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
  if (type === 'timestamp') return isTimestamp(raw) ? normalizeTimestamp(raw) : null;
  return raw;
}

/** What a reference position expects: a table, a scalar, or (on `run=`) a mutation. */
type RefKind = 'table' | 'scalar' | 'mutation';

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
    DeckGL: { data: 'table' },
    // A folder's listing, bound to the children table its <Query> reads.
    Files: { data: 'table' },
    // The kit CONTROL components (components/kit/controls.tsx): the same
    // two-way scalar bindings the native controls carry, in themed chrome.
    // `options` is a table exactly like `<select options>` (column 1 the
    // value, column 2 the label when present).
    // The TEXT fields. `value` only: a text box holds a scalar and nothing
    // else, and Enter reaching a `run=` form is the browser's own implicit
    // submission through the real `<input>` inside — not a binding of its own.
    Input: { value: 'scalar' },
    Textarea: { value: 'scalar' },
    Select: { value: 'scalar', options: 'table', run: 'mutation' },
    Slider: { value: 'scalar' },
    DatePicker: { value: 'scalar', run: 'mutation' },
    Segmented: { value: 'scalar', options: 'table' },
    Switch: { checked: 'scalar' },
    // The one TRIGGER position: a kit <Button run="$name"> runs the named
    // <Mutation> with the document's current values (components/kit/button
    // static face; lib/story-runtime/StoryRuntimeApp live face).
    Button: { run: 'mutation' },
    Dialog: {open: 'scalar'},
    DialogContent: {run: 'mutation'},
    // A person (components/kit/user.tsx), and the two halves they are made of
    // — the face (user-image.tsx) and the handle (user-handle.tsx). `userId`
    // READS its reference and never writes it back, which is what lets the
    // viewer's own `$_me.id` sit there (lib/story/builtins READ_ONLY_REF_ATTRS).
    User: { userId: 'scalar' },
    UserImage: { userId: 'scalar' },
    UserHandle: { userId: 'scalar' },
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
const TEMPLATE_REF_ATTRS: {
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
interface RefNameUse extends Span {
  name: string;
  tag: string;
  attr: string;
  expects: RefKind;
  /** True where the reference is only READ — the positions a built-in (`$_me.id`) may sit in. */
  readOnly?: boolean;
}

// ── parsing the two Helmet children ─────────────────────────────────────────

type ParseDeclResult<T> = { ok: true; decl: T } | { ok: false; errors: ValidationError[] };

const DATE_RE = /^\d{4}-\d{2}-\d{2}([T ].*)?$/;

const err = (message: string, span: Span, tag: string, attr?: string): ValidationError =>
  ({ message, tag, start: span.start, end: span.end, ...(attr ? { attr } : {}) });

/** Static JSON of an attribute, or `undefined` when absent / non-static. */
const staticAttr = (el: JsxElement, name: string): { attr: JsxAttribute; json: JsonValue } | { attr: JsxAttribute; json?: undefined } | undefined => {
  const attr = el.attributes.find((a) => a.name === name);
  if (!attr) return undefined;
  return attr.value.static ? { attr, json: attr.value.json } : { attr };
};

/** `name` on every declaration: an identifier outside the built-ins' reserved space. */
function checkName(el: JsxElement, tag: string, errors: ValidationError[]): string | null {
  const got = staticAttr(el, 'name');
  if (!got) { errors.push(err(`<${tag}> needs a name attribute`, el, tag, 'name')); return null; }
  if (typeof got.json !== 'string' || !DECL_NAME_RE.test(got.json)) {
    errors.push(err(`<${tag}> name must be an identifier ([A-Za-z_][A-Za-z0-9_]*), got ${JSON.stringify(got.json ?? got.attr.value)}`, got.attr, tag, 'name'));
    return null;
  }
  const reserved = reservedDeclarationName(got.json);
  if (reserved) {
    errors.push(err(`<${tag}> name "${got.json}" is reserved — ${reserved}`, got.attr, tag, 'name'));
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
    case 'timestamp': return isTimestamp(v);
    case 'date': return typeof v === 'string' && DATE_RE.test(v);
    case 'user':
    case 'string': return typeof v === 'string';
  }
};

const VALUE_ATTRS = new Set(['name', 'type', 'default', 'value', 'columns', 'source', 'column', 'constraints', 'url']);

/**
 * `<Value name type? default? value? columns? source? column? constraints? url? />`
 * → a declaration, or the precise errors. Attributes (VALUE_ATTRS; anything
 * else is rejected by name): `name` (identifier), `type` (VALUE_TYPES,
 * defaulting to "string", or to "user" when `source` is present), `default`
 * (scalar matching the type; dates are ISO strings), `value` (table rows —
 * required for and only for type "table"), `columns` (`[{name, type}]`, table
 * only), and the BOUND form's `source` (`ref:<id>`) + `column` (the field it
 * inherits its type and `constraints` from — so a bound Value may write neither
 * `type` nor `constraints` itself, and `column` without `source` is an error).
 * `url={false}` (SCALAR only) keeps this Value out of the address in both
 * directions — lib/story/url-values.
 */
export function parseValueDecl(el: JsxElement): ParseDeclResult<ValueDecl> {
  const tag = VALUE_TAG;
  const errors: ValidationError[] = [];
  for (const a of el.attributes) {
    if (!VALUE_ATTRS.has(a.name)) errors.push(err(`<Value> takes name, type, default, value, columns, url — not "${a.name}"`, a, tag, a.name));
    else if (!a.value.static) errors.push(err(`<Value> attribute "${a.name}" must be a JSON literal, got ${a.value.exprType}`, a, tag, a.name));
  }
  if (errors.length) return { ok: false, errors };
  const name = checkName(el, tag, errors);
  if (!name) return { ok: false, errors };

  const typeAttr = staticAttr(el, 'type');
  const sourceAttr=staticAttr(el,'source'), columnAttr=staticAttr(el,'column'), constraintsAttr=staticAttr(el,'constraints');
  const type = (typeAttr?.json ?? (sourceAttr ? 'user' : 'string')) as ValueType;
  if(sourceAttr && (typeof sourceAttr.json!=='string' || !/^ref:[A-Za-z0-9]{6,12}$/.test(sourceAttr.json) || typeof columnAttr?.json!=='string' || !columnAttr.json || typeAttr || constraintsAttr))return {ok:false,errors:[err('A bound Value takes source="ref:<dataset>" and column="<field>"; type and constraints are inherited',el,tag,'source')]};
  if(columnAttr&&!sourceAttr)return {ok:false,errors:[err('Value column requires source',el,tag,'column')]};
  let constraints:import('@artifactbin/contracts').UserConstraints|undefined;
  if(constraintsAttr) { try { constraints=parseDatasetColumn({name,type,constraints:constraintsAttr.json}).constraints; } catch(error) {return {ok:false,errors:[err(error instanceof Error?error.message:'Invalid constraints',el,tag,'constraints')]};} }
  if (!VALUE_TYPES.includes(type)) {
    return { ok: false, errors: [err(`<Value name="${name}"> type must be one of ${VALUE_TYPES.join(' | ')}, got ${JSON.stringify(typeAttr?.json)}`, typeAttr?.attr ?? el, tag, 'type')] };
  }
  /*
   * `url={false}` — the one Value that does NOT travel in the link. Only a
   * scalar does in the first place (a table's rows were never settable from an
   * address), and `url={true}` is the default said out loud, so it leaves no
   * field behind: the declaration a document at rest carries is unchanged.
   */
  const urlAttr = staticAttr(el, 'url');
  if (urlAttr && typeof urlAttr.json !== 'boolean') {
    return { ok: false, errors: [err(`<Value name="${name}"> url must be true or false, got ${JSON.stringify(urlAttr.json ?? urlAttr.attr.value)}`, urlAttr.attr, tag, 'url')] };
  }
  if (urlAttr && type === 'table') {
    return { ok: false, errors: [err(`<Value name="${name}" type="table"> takes no url= — only a scalar <Value> travels in the link`, urlAttr.attr, tag, 'url')] };
  }
  const outOfUrl = urlAttr?.json === false;
  const def = staticAttr(el, 'default');
  const val = staticAttr(el, 'value');
  const cols = staticAttr(el, 'columns');

  if (type === 'table') {
    if (def) errors.push(err(`<Value name="${name}" type="table"> holds its rows in value=, not default=`, def.attr, tag, 'default'));
    if (!val) return { ok: false, errors: [...errors, err(`<Value name="${name}" type="table"> needs value={[{…}, …]} — a non-empty array of flat objects`, el, tag, 'value')] };
    const rows = val.json;
    // Rows are where a table's columns are inferred from, so an empty one has no shape —
    // unless the author declared the columns: a temporary table a local Mutation fills starts empty.
    if (!Array.isArray(rows) || (rows.length === 0 && !cols)) {
      return { ok: false, errors: [...errors, err(`<Value name="${name}"> value must be a non-empty array of flat objects, or value={[]} with columns={[{name, type}]}`, val.attr, tag, 'value')] };
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
      if (!okShape) return { ok: false, errors: [err(`<Value name="${name}"> columns must be [{name, type: string|number|boolean|date|timestamp|user}]`, cols.attr, tag, 'columns')] };
      let declaredCols:DatasetColumn[];
      try {declaredCols=(declared as unknown[]).map(parseDatasetColumn);}catch(error){return {ok:false,errors:[err(error instanceof Error?error.message:'Invalid columns',el,tag,'columns')]};}
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
  return { ok: true, decl: { kind: 'scalar', name, type, ...(sourceAttr?{source:String(sourceAttr.json).slice(4),column:String(columnAttr!.json)}:{}), ...(constraints?{constraints}:{}), ...(outOfUrl ? { url: false as const } : {}), default: type==='timestamp'&&dflt!==null?normalizeTimestamp(dflt,name):dflt, start: el.start, end: el.end } };
}

/** The single template-literal child holding a statement's SQL, or null. */
function sqlChild(el: JsxElement): string | null {
  const kids = el.children.filter((c) => !(c.type === 'text' && c.value.trim() === ''));
  const kid = kids.length === 1 ? kids[0] : null;
  return kid && kid.type === 'expression' && kid.value.static && typeof kid.value.json === 'string' ? kid.value.json : null;
}

/** A literal `ref:<id>` attribute, or the error that says how to write one. */
function refAttribute(el: JsxElement, name: string, errors: ValidationError[]): string | undefined {
  const attribute = el.attributes.find((a) => a.name === name);
  if (!attribute) return;
  const value = attribute.value.static ? attribute.value.json : undefined;
  const id = typeof value === 'string' ? ARTIFACT_REFERENCE_PATTERN.exec(value)?.[1] : undefined;
  if (!id) {
    const example = typeof value === 'string' && ARTIFACT_ID_PATTERN.test(value) ? `ref:${value}` : 'ref:<id>';
    errors.push(err(`${name} must be a literal artifact reference: ${name}="${example}"`, attribute, el.tag, name));
    return;
  }
  return id;
}

/**
 * `<Import name src />` → a declaration: `name` (the schema its tables are
 * read under) and `src="ref:<id>"`. What the artifact is — a dataset, a
 * folder, or a connected database that cannot be imported — is the
 * compiler's to say, with the artifact in hand.
 */
export function parseImportDecl(el: JsxElement): ParseDeclResult<ImportDecl> {
  const tag = IMPORT_TAG;
  const errors: ValidationError[] = [];
  for (const a of el.attributes) if (a.name !== 'name' && a.name !== 'src') errors.push(err(`<Import> takes only name= and src="ref:<id>" — not "${a.name}"`, a, tag, a.name));
  if (el.children.some((c) => !(c.type === 'text' && c.value.trim() === ''))) errors.push(err('<Import> has no children: <Import name="…" src="ref:<id>" />', el, tag));
  if (errors.length) return { ok: false, errors };
  const name = checkName(el, tag, errors);
  const ref = refAttribute(el, 'src', errors);
  if (!el.attributes.some((a) => a.name === 'src')) errors.push(err(`<Import${name ? ` name="${name}"` : ''}> needs src="ref:<id>" — the dataset or folder it reads`, el, tag, 'src'));
  if (!name || !ref || errors.length) return { ok: false, errors };
  return { ok: true, decl: { name, ref, start: el.start, end: el.end } };
}

/**
 * `<Query name source?>{`sql`}</Query>` → a declaration, or the errors: the
 * single child is a template literal (SQL keeps `<`, `>` and braces raw that
 * way — the same rule as `<style>`); `source=` names a connected Postgres
 * dataset the query runs inside (a stored dataset is an `<Import>` — the
 * compiler says so once it can see which one this is).
 */
export function parseQueryDecl(el: JsxElement): ParseDeclResult<QueryDecl> {
  const tag = QUERY_TAG;
  const errors: ValidationError[] = [];
  for (const a of el.attributes) {
    if (a.name !== 'name' && a.name !== 'source') errors.push(err(`<Query> takes only name= and source= — the SQL is its child: <Query name="…">{\`select …\`}</Query>${a.name === 'sql' ? ' (not a sql= attribute)' : ''}`, a, tag, a.name));
  }
  if (errors.length) return { ok: false, errors };
  const name = checkName(el, tag, errors);
  if (!name) return { ok: false, errors };
  const sql = sqlChild(el);
  if (sql === null) return { ok: false, errors: [err(`<Query name="${name}"> holds a single template-literal child with the SQL: <Query name="${name}">{\`select …\`}</Query>`, el, tag)] };
  if (sql.trim() === '') return { ok: false, errors: [err(`<Query name="${name}"> has empty SQL`, el, tag)] };
  const source = refAttribute(el, 'source', errors);
  if (errors.length) return { ok: false, errors };
  return { ok: true, decl: { name, sql, ...(source ? { source } : {}), start: el.start, end: el.end } };
}

/**
 * `<Mutation name expectedAffected? reset?>{`sql`}</Mutation>` → a
 * declaration, or the errors. The Query rules (one template-literal child,
 * non-empty); what it writes is the compiler's to establish from SQLite's own
 * analysis — exactly one imported table or one local table Value.
 */
export function parseMutationDecl(el: JsxElement): ParseDeclResult<MutationDecl> {
  const tag = MUTATION_TAG;
  const errors: ValidationError[] = [];
  for (const a of el.attributes) {
    if (a.name === 'source') errors.push(err('<Mutation> takes no source= — import the dataset (<Import name="…" src="ref:<id>" />) and write its table by name: insert into <name>.rows …', a, tag, a.name));
    else if (a.name !== 'name' && a.name !== 'expectedAffected' && a.name !== 'reset') errors.push(err(`<Mutation> takes only name=, expectedAffected= and reset= — the SQL is its child: <Mutation name="…">{\`insert into <import>.rows …\`}</Mutation>${a.name === 'sql' ? ' (not a sql= attribute)' : ''}`, a, tag, a.name));
  }
  if (errors.length) return { ok: false, errors };
  const name = checkName(el, tag, errors);
  if (!name) return { ok: false, errors };
  const sql = sqlChild(el);
  if (sql === null) return { ok: false, errors: [err(`<Mutation name="${name}"> holds a single template-literal child with the SQL: <Mutation name="${name}">{\`insert into <import>.rows …\`}</Mutation>`, el, tag)] };
  if (sql.trim() === '') return { ok: false, errors: [err(`<Mutation name="${name}"> has empty SQL`, el, tag)] };
  const expected = staticAttr(el, 'expectedAffected');
  if (expected && (typeof expected.json !== 'number' || !Number.isInteger(expected.json) || expected.json < 0)) {
    return { ok: false, errors: [err(`<Mutation expectedAffected> must be a non-negative integer`, expected.attr, tag, 'expectedAffected')] };
  }
  /*
   * `reset="draft amount"` — the form this write clears once it has SUCCEEDED.
   * A static, space-separated list of names; that each one is a declared scalar
   * is a whole-document fact, so it is checked in `validateDataflow` where the
   * declarations are in hand. Empty is absent: nothing to clear.
   */
  const resetAttr = staticAttr(el, 'reset');
  if (resetAttr && typeof resetAttr.json !== 'string') {
    return { ok: false, errors: [err(`<Mutation name="${name}"> reset must be a space-separated list of scalar <Value> names, got ${JSON.stringify(resetAttr.json ?? resetAttr.attr.value)}`, resetAttr.attr, tag, 'reset')] };
  }
  const reset = typeof resetAttr?.json === 'string' ? resetAttr.json.trim().split(/\s+/).filter(Boolean) : [];
  return { ok: true, decl: { name, sql, ...(expected ? { expectedAffected: expected.json as number } : {}), ...(reset.length ? { reset } : {}), start: el.start, end: el.end } };
}

// ── the reference graph ─────────────────────────────────────────────────────

/** Every `$name` reference in the BODY, from the REF_ATTRS positions only. */
export function collectRefNameUses(body: JsxNode[]): RefNameUse[] {
  const out: RefNameUse[] = [];
  const expressionUses = (expression: ReactiveExpression | undefined, span: Span, tag: string, attr: string) => {
    // A reactive expression only reads: `{$_me.id ? … : …}` never writes anything.
    if (expression) for (const name of reactiveNames(expression).signals) out.push({name, tag, attr, expects: 'scalar', readOnly: true, start: span.start, end: span.end});
  };
  const visit = (nodes: JsxNode[]) => {
    for (const n of nodes) {
      if (n.type === 'expression' && !n.value.static) expressionUses(n.value.reactive, n, 'expression', 'value');
      if (n.type !== 'element') continue;
      if (n.control && n.control.kind !== 'fragment') expressionUses(n.control.test, n, 'condition', 'test');
      for (const a of n.attributes) if (!a.value.static) {
        if(n.tag === 'For' && a.name === 'each' && a.value.reactive?.kind === 'signal') out.push({name:a.value.reactive.name,tag:n.tag,attr:a.name,expects:'table',start:a.start,end:a.end});
        else expressionUses(a.value.reactive, a, n.tag, a.name);
      }
      // `set=` WRITES its keys (declared scalar Values) and READS its sources; `args=` only reads.
      for (const a of n.attributes) {
        if ((a.name !== SET_ATTR && a.name !== ARGS_ATTR) || !a.value.static) continue;
        for (const [key, source] of Object.entries(bindingMap(a.value.json) ?? {})) {
          if (a.name === SET_ATTR) out.push({ name: key, tag: n.tag, attr: a.name, expects: 'scalar', start: a.start, end: a.end });
          if ('ref' in source && !source.ref.startsWith('_row.')) out.push({ name: source.ref, tag: n.tag, attr: a.name, expects: 'scalar', readOnly: true, start: a.start, end: a.end });
        }
      }
      const table = n.isComponent ? REF_ATTRS.components[n.tag] : REF_ATTRS.html[n.tag.toLowerCase()];
      if (table) {
        for (const a of n.attributes) {
          const expects = table[n.isComponent ? a.name : a.name.toLowerCase()];
          if (!expects || !a.value.static) continue;
          const readOnly = !!(n.isComponent && READ_ONLY_REF_ATTRS[n.tag]?.has(a.name));
          const name = refName(a.value.json);
          if (name) { out.push({ name, tag: n.tag, attr: a.name, expects, readOnly, start: a.start, end: a.end }); continue; }
          // …and, in the one position that reads it, every `{$name}` inside the
          // string. Same kind, same checks, same refusal — one use per name.
          if (!isTemplateRefPosition(n.tag, a.name, n.isComponent)) continue;
          for (const templated of templateRefNames(a.value.json)) {
            out.push({ name: templated, tag: n.tag, attr: a.name, expects, readOnly, start: a.start, end: a.end });
          }
        }
      }
      visit(n.children);
    }
  };
  visit(body);
  return out;
}

/**
 * Publish-time semantics of the MARKUP over the declarations. Reports, with spans:
 *  - a name declared twice (across Imports, Values, Queries and Mutations);
 *  - a `$name` reference to nothing declared, or to the wrong kind
 *    (`data="$region"` where region is a scalar, `value="$sales"` where sales
 *    is a table, `data="$bookings"` where bookings is an Import);
 *  - a built-in bound where it would be written (built-ins are read-only),
 *    and the bare `$_me` (a row; its field is `$_me.id`);
 *  - `reset=` naming anything but a scalar Value.
 * What the SQL reads and binds is the compiler's (lib/story/compile-dataflow).
 * [] = valid.
 */
export function validateDataflow(flow: Dataflow, uses: RefNameUse[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const kinds = new Map<string, RefKind | 'import'>();
  const declare = (name: string, kind: RefKind | 'import', span: Span, tag: string) => {
    if (kinds.has(name)) {
      errors.push(err(`"${name}" is declared twice in <Helmet> — every <Import>/<Value>/<Query>/<Mutation> name is unique`, span, tag, 'name'));
      return;
    }
    kinds.set(name, kind);
  };
  for (const i of flow.imports) declare(i.name, 'import', i, IMPORT_TAG);
  for (const v of flow.values) declare(v.name, v.kind === 'table' ? 'table' : 'scalar', v, VALUE_TAG);
  for (const q of flow.queries) declare(q.name, 'table', q, QUERY_TAG);
  for (const m of flow.mutations) declare(m.name, 'mutation', m, MUTATION_TAG);

  const hint = ' — declare it in <Helmet> as <Value name="…" …/> or <Query name="…">{`…`}</Query>';
  const describe = (kind: RefKind | 'import'): string =>
    kind === 'scalar' ? 'a scalar <Value>' : kind === 'table' ? 'a table' : kind === 'import' ? 'an <Import> (read it in a <Query>: select … from <name>.rows)' : 'a <Mutation>';
  for (const u of uses) {
    if (u.name === VIEWER) {
      errors.push(err(`<${u.tag} ${u.attr}="$_me"> — $_me is the reader as a row; read its id: $${VIEWER_ID}`, u, u.tag, u.attr));
      continue;
    }
    if (u.name.startsWith('_')) {
      // A built-in: admitted only where a reference is READ, and only the ones markup may read.
      const builtin = builtinInput(u.name);
      if (!builtin?.markup) errors.push(err(`<${u.tag} ${u.attr}="$${u.name}"> — ${builtin ? `$${u.name} is not readable in markup` : `$${u.name} is not a built-in`}; markup reads $${VIEWER_ID}`, u, u.tag, u.attr));
      else if (!u.readOnly || u.expects !== 'scalar') errors.push(err(`<${u.tag} ${u.attr}="$${u.name}"> cannot bind $${u.name} — built-ins are read-only. Read it in a condition ({$${u.name} ? … : …}) or show the person with <User userId="$${u.name}" />`, u, u.tag, u.attr));
      continue;
    }
    const kind = kinds.get(u.name);
    if (!kind) {
      errors.push(err(`<${u.tag} ${u.attr}="$${u.name}"> refers to nothing declared${u.expects === 'mutation' ? ' — declare it in <Helmet> as <Mutation name="…">{`insert into <import>.rows …`}</Mutation>' : hint}`, u, u.tag, u.attr));
    } else if (kind !== u.expects) {
      errors.push(err(
        u.expects === 'table'
          ? `<${u.tag} ${u.attr}="$${u.name}"> needs a table (a <Query> or a <Value type="table">), but "${u.name}" is ${describe(kind)}`
          : u.expects === 'scalar'
            ? `<${u.tag} ${u.attr}="$${u.name}"> binds a scalar value, but "${u.name}" is ${describe(kind)} — bind a <Value> (string | number | boolean | date | timestamp | user)`
            : `<${u.tag} ${u.attr}="$${u.name}"> needs a <Mutation>, but "${u.name}" is ${describe(kind)} — run= names the write a click performs`,
        u, u.tag, u.attr,
      ));
    }
  }

  // `reset=` clears a FORM: every name must be a scalar <Value> with a default to go back to.
  for (const m of flow.mutations) for (const name of m.reset ?? []) {
    const kind = kinds.get(name);
    if (kind !== 'scalar') {
      errors.push(err(`<Mutation name="${m.name}"> reset="… ${name} …" names ${kind ? describe(kind) : 'nothing declared'} — reset clears scalar <Value>s${kind ? '' : hint}`, m, MUTATION_TAG, 'reset'));
    }
  }
  return errors;
}

/** True when the document declares nothing. */
export const isEmptyDataflow = (flow: Dataflow): boolean =>
  flow.imports.length === 0 && flow.values.length === 0 && flow.queries.length === 0 && flow.mutations.length === 0;

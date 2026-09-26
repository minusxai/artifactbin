/**
 * OLD DOCUMENT SYNTAX → NEW, for the one-off migration of every stored
 * document to SQLite:
 *
 *  - a stored dataset read through `source="ref:X"` or a legacy `ref_X`
 *    table becomes one `<Import name="…" src="ref:X" />`, first in the
 *    Helmet, and its tables are read as `<name>.<table>`;
 *  - every SQL body goes through {@link translateSql} (a connected Postgres
 *    dataset keeps its `source=` and its SQL, bar `$_me`);
 *  - a local mutation that only assigns literals and values to `_signals`
 *    becomes `set={{…}}` on each control that ran it;
 *  - `$_me` becomes `$_me.id`, in SQL and markup. (`$_row.col` and `$_value`
 *    stay: they are built-in context inputs the compiler binds.)
 *
 * Edits are spliced into the original text at parser spans, so everything no
 * rule touches stays byte-identical; the serializer renders only the new
 * pieces. All or nothing: when anything needs a person, `source` comes back
 * unchanged, `manual` says why and where (offsets into the input), and
 * `changes` lists what the automatic part would have done.
 */
import { ARTIFACT_REFERENCE_PATTERN } from '@artifactbin/contracts';
import { parseJsx, serializeJsx, type JsonValue, type JsxAttribute, type JsxElement, type JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { removedSqlReferenceTokens } from '@/lib/migrate/sqlite/legacy-tokens';
import { significant, tokenizeSql, word, type SqlToken } from './tokens';
import { translateSql, type ManualItem } from './translate';

export interface ConvertLookups {
  /** The Import name for a stored dataset — the migration passes a slug of its title. Invalid or absent: `data_<id>`. */
  importName(ref: string): string | null | undefined;
  /**
   * What the artifact is: a stored dataset or a folder becomes an `<Import>`
   * (a folder's listing reads as `<name>.rows`); a connected Postgres dataset
   * keeps `source=` and its SQL.
   */
  kind(ref: string): 'dataset' | 'postgres' | 'folder';
  /** A stored dataset table's column names, for `* EXCLUDE (…)`; null when unknown. */
  columns?(ref: string, table: string): readonly string[] | null;
}

export interface ConversionChange {
  rule: 'import' | 'source' | 'sql' | 'signals' | 'viewer';
  /** The declaration it concerns, by name. */
  declaration?: string;
  detail: string;
  notes?: string[];
}

export interface ConversionManual extends ManualItem {
  declaration?: string;
}

export interface DocumentConversion {
  source: string;
  changes: ConversionChange[];
  manual: ConversionManual[];
}

type Edit = { start: number; end: number; text: string };

const DECL_NAME = /^[A-Za-z_]\w*$/;
const VIEWER = /\$_me(?![\w.])/g;
/**
 * Names an Import may not take: SQLite's keywords (`order.rows` does not
 * parse) and its own schema names. Built-ins start with `_` and legacy tables
 * with `ref_`, which are refused separately.
 */
const RESERVED = new Set(`abort action add after all alter always analyze and as asc attach autoincrement before begin between by cascade case cast check
  collate column commit conflict constraint create cross current current_date current_time current_timestamp database default deferrable deferred
  delete desc detach distinct do drop each else end escape except exclude exclusive exists explain fail filter first following for foreign from full
  generated glob group groups having if ignore immediate in index indexed initially inner insert instead intersect into is isnull join key last left
  like limit match materialized natural no not nothing notnull null nulls of offset on or order others outer over partition plan pragma preceding
  primary query raise range recursive references regexp reindex release rename replace restrict returning right rollback row rows savepoint select
  set table temp temporary then ties to transaction trigger unbounded union unique update using vacuum values view virtual when where window with
  without main`.split(/\s+/));

const elements = (nodes: JsxNode[]): JsxElement[] => nodes.filter((n): n is JsxElement => n.type === 'element');
const staticString = (el: JsxElement, name: string): string | null => {
  const attr = el.attributes.find((a) => a.name === name);
  return attr?.value.static && typeof attr.value.json === 'string' ? attr.value.json : null;
};

/** The single template-literal child holding a declaration's SQL. */
function sqlChild(el: JsxElement): { node: JsxNode; sql: string } | null {
  const kids = el.children.filter((c) => !(c.type === 'text' && c.value.trim() === ''));
  const kid = kids.length === 1 ? kids[0] : null;
  return kid?.type === 'expression' && kid.value.static && typeof kid.value.json === 'string' ? { node: kid, sql: kid.value.json } : null;
}

/** An attribute as the serializer writes it (it renders elements, so render one and keep the attribute). */
function attributeSource(name: string, json: JsonValue): string {
  const element: JsxElement = { type: 'element', tag: 'x', isComponent: false, attributes: [{ name, value: { static: true, json }, start: 0, end: 0 }], children: [], selfClosing: true, start: 0, end: 0 };
  return serializeJsx([element]).slice('<x '.length, -' />'.length);
}

/** Remove an attribute with the whitespace before it. */
function removal(source: string, attr: JsxAttribute): Edit {
  let start = attr.start;
  while (start > 0 && /[ \t\n]/.test(source[start - 1])) start--;
  return { start, end: attr.end, text: '' };
}

/** Remove an element and the line it stood on, when it stood alone. */
function elementRemoval(source: string, el: JsxElement): Edit {
  let start = el.start;
  while (start > 0 && /[ \t]/.test(source[start - 1])) start--;
  if (start > 0 && source[start - 1] === '\n') start--;
  else start = el.start;
  return { start, end: el.end, text: '' };
}

/**
 * `update _signals set a = 'x', b = $v, c = $_row.id, d = e` → `{"a": "x", "b": "$v", "c": "$_row.id", "d": "$e"}`
 * (a column of _signals — one of the document's `values`, by lower-cased name — is that page value),
 * or the reason it is not that simple. The runtime reads every source before
 * it sets any, as SQL reads the old row, so `a = b, b = a` swaps either way.
 */
function signalAssignments(sql: string, values: ReadonlyMap<string, string>): Record<string, JsonValue> | string {
  let t;
  try { t = significant(tokenizeSql(sql)); } catch (error) { return (error as Error).message; }
  if (t.at(-1)?.text === ';') t = t.slice(0, -1);
  if (word(t[0]) !== 'update' || word(t[1]) !== SIGNALS_TABLE || word(t[2]) !== 'set') return 'not a plain UPDATE _signals SET';
  const set: Record<string, JsonValue> = {};
  let i = 3;
  for (;;) {
    const column = t[i];
    if (!column || !['word', 'quoted'].includes(column.kind) || t[i + 1]?.text !== '=') return 'not a plain assignment list';
    const name = column.kind === 'quoted' ? column.text.slice(1, -1).replaceAll('""', '"') : column.text;
    let j = i + 2;
    let value: JsonValue;
    const v = t[j];
    if (!v) return 'an assignment without a value';
    if (v.kind === 'number') value = Number(v.text);
    else if (v.text === '-' && t[j + 1]?.kind === 'number') { value = -Number(t[++j].text); }
    else if (v.kind === 'string') {
      value = v.text.slice(1, -1).replaceAll("''", "'");
      if (value.startsWith('$')) return `the string '${value}' would read as a value reference in set=`;
    } else if (['true', 'false', 'null'].includes(word(v))) value = JSON.parse(word(v));
    else if (v.kind === 'param' && v.text === '$_value') return '$_value has no control to come from in set=';
    else if (v.kind === 'param' && t[j + 1]?.text === '.' && t[j + 1].start === v.end && t[j + 2]?.kind === 'word') { value = `${v.text}.${t[j + 2].text}`; j += 2; }
    else if (word(v) === 'cast' && t[j + 1]?.text === '(' && t[j + 2]?.kind === 'param') {
      // `cast($x as T)` sets $x: the compiler checks that its type is the Value's.
      const ref = t[j + 2];
      const dotted = t[j + 3]?.text === '.' && t[j + 3].start === ref.end && t[j + 4]?.kind === 'word';
      const as = j + (dotted ? 5 : 3);
      const close = t.findIndex((token, k) => k > as && token.text === ')');
      if (word(t[as]) !== 'as' || close < 0 || t.slice(as + 1, close).some((token) => token.text === '(') || ref.text === '$_value' || (ref.text === '$_row' && !dotted)) return `${name} is set to an expression`;
      value = dotted ? `${ref.text}.${t[j + 4].text}` : ref.text === '$_me' ? '$_me.id' : ref.text;
      j = close;
    }
    else if (v.kind === 'param' && v.text.length > 1 && v.text !== '$_row') value = v.text === '$_me' ? '$_me.id' : v.text;
    else if (v.kind === 'word' && values.has(word(v)) && (!t[j + 1] || t[j + 1].text === ',')) value = `$${values.get(word(v))}`;
    else return computed(t, j, name, values) ?? `${name} is set to an expression`;
    set[name] = value;
    if (!t[j + 1]) return set;
    if (t[j + 1].text !== ',') return word(t[j + 1]) === 'where' ? 'the update has a WHERE clause' : `${name} is set to an expression`;
    i = j + 2;
  }
}

/**
 * Why assigning `name` the expression from token `j` on, which reads page
 * values (`step + 1`), needs a person: set= only copies. Null when it reads none.
 */
function computed(t: SqlToken[], j: number, name: string, values: ReadonlyMap<string, string>): string | null {
  let end = j;
  for (let depth = 0; end < t.length && (depth > 0 || t[end].text !== ','); end++) depth += t[end].text === '(' ? 1 : t[end].text === ')' ? -1 : 0;
  const reads = t.slice(j, end).some((token, k) => token.kind === 'word' && values.has(word(token)) && t[j + k + 1]?.text !== '(' && t[j + k - 1]?.text !== '.');
  if (!reads) return null;
  const text = t.slice(j, end).map((token) => token.text).join(' ');
  return `computes ${name} from page values (${text}): keep ${name} in a one-row <Value type="table"> updated by a local <Mutation>`;
}

/** The removed single-row table of page values. */
const SIGNALS_TABLE = '_signals';

/** Whether a statement writes `_signals`: its table after UPDATE, INSERT INTO or DELETE FROM. */
function writesSignals(sql: string): boolean {
  let t;
  try { t = significant(tokenizeSql(sql)); } catch { return false; }
  const op = word(t[0]);
  const at = op === 'update' ? 1 : (op === 'insert' && word(t[1]) === 'into') || (op === 'delete' && word(t[1]) === 'from') ? 2 : -1;
  return at > 0 && word(t[at]) === SIGNALS_TABLE;
}

/** Slug a lookup result into an Import name, or null when it cannot be one. */
function slug(name: string | null | undefined): string | null {
  const s = (name ?? '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  return s && DECL_NAME.test(s) && !/^\d/.test(s) && !s.startsWith('ref_') && !RESERVED.has(s) ? s : null;
}

export function convertDocument(source: string, lookups: ConvertLookups): DocumentConversion {
  const parsed = parseJsx(source);
  if (!parsed.ok) return { source, changes: [], manual: [{ reason: `the document does not parse: ${parsed.error}`, start: parsed.pos ?? 0, end: parsed.pos ?? 0 }] };
  const { helmet } = splitHelmet(parsed.nodes);
  const edits: Edit[] = [];
  const changes: ConversionChange[] = [];
  const manual: ConversionManual[] = [];
  const declarations = helmet ? elements(helmet.children) : [];
  const statements = declarations.filter((el) => el.tag === 'Query' || el.tag === 'Mutation');
  /** The page values, the columns `_signals` had: lower-cased name → the name declared. */
  const pageValues = new Map(declarations.filter((el) => el.tag === 'Value').flatMap((el) => { const n = staticString(el, 'name'); return n ? [[n.toLowerCase(), n] as const] : []; }));
  const taken = new Set(declarations.map((el) => staticString(el, 'name')?.toLowerCase()).filter((n): n is string => !!n));

  // ── imports, in first-appearance order ─────────────────────────────────
  // A document that reads exactly one dataset with no usable title calls it
  // plainly `data` (`data.rows`); several untitled ones keep their ids apart.
  const sourced = new Set(statements.map((el) => {
    const value = el.attributes.find((a) => a.name === 'source')?.value;
    return value?.static && typeof value.json === 'string' ? ARTIFACT_REFERENCE_PATTERN.exec(value.json)?.[1] : undefined;
  }).filter((ref): ref is string => !!ref && lookups.kind(ref) !== 'postgres'));
  const untitled = [...sourced].filter((ref) => !slug(lookups.importName(ref)));
  const imports = new Map<string, string>();
  const importFor = (ref: string): string => {
    const known = imports.get(ref);
    if (known) return known;
    const base = slug(lookups.importName(ref)) ?? (untitled.length === 1 && untitled[0] === ref ? 'data' : `data_${ref}`);
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base}_${n}`;
    taken.add(name.toLowerCase());
    imports.set(ref, name);
    return name;
  };

  /** `<import>.<table>` as a translated statement names it → that dataset table's columns. */
  const importColumns = (name: string): readonly string[] | null => {
    const [schema, table, ...rest] = name.split('.').map((part) => part.trim().replace(/^"(.*)"$/s, (_, inner: string) => inner.replaceAll('""', '"')));
    const ref = [...imports].find(([, as]) => as.toLowerCase() === schema?.toLowerCase())?.[0];
    return ref && table && !rest.length ? lookups.columns?.(ref, table) ?? null : null;
  };

  // ── statements ─────────────────────────────────────────────────────────
  const scriptText = declarations.filter((el) => el.tag === 'script').map((el) => sqlChild(el)?.sql ?? '').join('\n');
  const excluded: Array<{ start: number; end: number }> = [];
  for (const el of statements) {
    const name = staticString(el, 'name') ?? el.tag;
    const child = sqlChild(el);
    if (!child) continue;
    excluded.push(child.node);
    const sourceAttr = el.attributes.find((a) => a.name === 'source');
    const ref = sourceAttr?.value.static && typeof sourceAttr.value.json === 'string' ? ARTIFACT_REFERENCE_PATTERN.exec(sourceAttr.value.json)?.[1] : undefined;
    const statement = el.tag === 'Query' ? 'query' : 'mutation';
    // Offsets into the document: exact when the template literal holds no escapes.
    const raw = source.slice(child.node.start + 2, child.node.end - 2);
    const at = (item: ManualItem): ConversionManual => raw === child.sql
      ? { declaration: name, reason: item.reason, start: child.node.start + 2 + item.start, end: child.node.start + 2 + item.end }
      : { declaration: name, reason: item.reason, start: child.node.start, end: child.node.end };

    if (el.tag === 'Mutation' && !ref && writesSignals(child.sql)) {
      const set = signalAssignments(child.sql, pageValues);
      const refuse = (reason: string) => manual.push({ declaration: name, reason: `the _signals mutation ${reason}; set= takes literals and $values only`, start: el.start, end: el.end });
      if (typeof set === 'string') { refuse(set); continue; }
      if (el.attributes.some((a) => a.name === 'reset' || a.name === 'expectedAffected')) { refuse('has reset= or expectedAffected='); continue; }
      // A script may run it by a name it computes, so any mx.mutate call keeps it.
      if (scriptText.includes('mutate(')) { refuse('may be run by the script (it calls mx.mutate)'); continue; }
      const sites: JsxElement[] = [];
      const visit = (nodes: JsxNode[]) => { for (const n of elements(nodes)) { if (staticString(n, 'run') === `$${name}`) sites.push(n); visit(n.children); } };
      visit(parsed.nodes);
      if (sites.some((site) => site.attributes.some((a) => a.name === 'set'))) { refuse('is run by a control that already has set='); continue; }
      if (!sites.length && scriptText.trim()) { refuse('has no control that runs it, and the script might'); continue; }
      edits.push(elementRemoval(source, el));
      for (const site of sites) {
        const run = site.attributes.find((a) => a.name === 'run')!;
        edits.push({ start: run.start, end: run.end, text: attributeSource('set', set) });
      }
      changes.push({ rule: 'signals', declaration: name, detail: `set=${JSON.stringify(set)} on ${sites.length} control${sites.length === 1 ? '' : 's'}` });
      continue;
    }

    const postgres = !!ref && lookups.kind(ref) === 'postgres';
    const legacy = postgres ? [] : [...new Set(removedSqlReferenceTokens(child.sql).tokens.map((token) => token.id))];
    const pgLegacy = legacy.find((id) => lookups.kind(id) === 'postgres');
    if (pgLegacy) { manual.push({ declaration: name, reason: `reads the connected Postgres dataset ${pgLegacy} as ref_${pgLegacy}`, start: child.node.start, end: child.node.end }); continue; }
    const dataset = ref && !postgres ? importFor(ref) : undefined;
    const tables = Object.fromEntries(legacy.map((id) => [`ref_${id}`.toLowerCase(), `${importFor(id)}.rows`]));
    const result = translateSql(child.sql, { statement, ...(postgres ? { dialect: 'postgres' as const } : {}), ...(dataset ? { dataset } : {}), tables, columns: importColumns });
    if (result.manual.length) { manual.push(...result.manual.map(at)); continue; }
    if (ref && !postgres) {
      edits.push(removal(source, sourceAttr!));
      changes.push({ rule: 'source', declaration: name, detail: `source="ref:${ref}" became the Import ${imports.get(ref)}` });
    }
    if (result.sql !== child.sql) {
      edits.push({ start: child.node.start, end: child.node.end, text: serializeJsx([{ type: 'expression', value: { static: true, json: result.sql }, source: '', start: 0, end: 0 }]) });
      changes.push({ rule: 'sql', declaration: name, detail: 'translated to SQLite', ...(result.notes.length ? { notes: result.notes } : {}) });
    }
  }

  // ── the Import declarations, first in the Helmet ────────────────────────
  if (helmet && imports.size) {
    // Each Import on a line of its own, indented like the Helmet's first child.
    const first = helmet.children[0];
    const lead = first?.type === 'text' && first.value.trim() === '' && first.value.includes('\n') ? first.value : '';
    const indent = lead ? `\n${lead.slice(lead.lastIndexOf('\n') + 1)}` : '';
    const at = first?.start ?? helmet.end;
    const rendered = [...imports].map(([ref, name]) => {
      changes.push({ rule: 'import', declaration: name, detail: `<Import name="${name}" src="ref:${ref}" />` });
      return indent + serializeJsx([{ type: 'element', tag: 'Import', isComponent: true, attributes: [{ name: 'name', value: { static: true, json: name }, start: 0, end: 0 }, { name: 'src', value: { static: true, json: `ref:${ref}` }, start: 0, end: 0 }], children: [], selfClosing: true, start: 0, end: 0 }]);
    });
    edits.push({ start: at, end: at, text: rendered.join('') });
  }

  // ── $_me → $_me.id in markup: attributes and expressions, not prose, SQL, CSS or script ──
  const skip = (nodes: JsxNode[]) => {
    for (const n of nodes) {
      if (n.type === 'text' || (n.type === 'expression' && n.value.static)) excluded.push(n);
      if (n.type === 'element') skip(n.children);
    }
  };
  skip(parsed.nodes);
  let viewers = 0;
  for (const match of source.matchAll(VIEWER)) {
    const start = match.index;
    const end = start + match[0].length;
    if ([...excluded, ...edits].some((r) => start >= r.start && end <= r.end)) continue;
    edits.push({ start, end, text: '$_me.id' });
    viewers++;
  }
  if (viewers) changes.push({ rule: 'viewer', detail: `$_me became $_me.id in ${viewers} place${viewers === 1 ? '' : 's'} of markup` });

  if (manual.length) return { source, changes, manual };
  let output = source;
  for (const edit of edits.sort((a, b) => b.start - a.start || b.end - a.end)) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  const check = parseJsx(output);
  if (!check.ok) return { source, changes, manual: [{ reason: `the converted document does not parse: ${check.error}`, start: 0, end: source.length }] };
  return { source: output, changes, manual };
}

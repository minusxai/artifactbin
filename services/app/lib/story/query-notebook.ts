/**
 * THE QUERY NOTEBOOK — every `<Query>` a document declares, read as cells.
 *
 * A lens over the source and the editor's dataflow state, the way
 * lib/story/table-catalog lists tables for the binding pickers: pure, derived
 * from the document, never fetched. Each cell pairs one declaration with what
 * the last run made of it — rows, the engine's refusal, or nothing yet — and
 * with what in the body reads it, so the editor can show SQL, answer and the
 * embeds it powers together. An edit to a cell's SQL writes back into that
 * declaration alone; the editor's own dataflow refresh (keyed on the
 * declarations) re-runs it, so the notebook needs no query path of its own.
 */
import { parseJsx, serializeJsx, type JsxElement, type JsxNode } from '@/lib/jsx';
import { HELMET_TAG, splitHelmet } from './helmet';
import { helmetOffset } from './edit-compose';
import { QUERY_TAG, refName, type DataflowState, type QueryDecl, type TableResult } from './dataflow';
import type { CompiledDataflow } from './compiled-dataflow';

/** A body element that reads a declared table: `data="$name"` on an embed, `options="$name"` on a control. */
export interface BoundEmbed {
  tag: string;
  /** Its `title`, when it has one — what a reader knows it as. */
  label: string | null;
  /** The BODY path the document renders it at (STORY_SPOTLIGHT_MESSAGE / STORY_SELECT_MESSAGE speak these). */
  path: string;
}

export interface QueryCell {
  /** The declared name (`data="$name"` binds it). */
  name: string;
  sql: string;
  /** The artifact the query reads: its connected database (`source="ref:<id>"`) or the import it reads, if known. */
  source: string | null;
  /** The last run's rows — null until a run has answered, or when it refused. */
  result: TableResult | null;
  /** The engine's message when the last run refused this query. */
  error: string | null;
  /** True while a run that will answer this cell is in flight. */
  pending: boolean;
  /** What in the body reads this query, in document order. */
  bound: BoundEmbed[];
}

/** The attributes through which a body element names a declared table. */
const BINDING_ATTRS: ReadonlySet<string> = new Set(['data', 'options']);

const staticString = (el: JsxElement, name: string): string | null => {
  const attr = el.attributes.find((a) => a.name === name);
  return attr?.value.static && typeof attr.value.json === 'string' ? attr.value.json : null;
};

/**
 * Every element bound to a declared name, keyed by that name. Paths are BODY
 * paths: the Helmet is hoisted out of the rendered tree, so a top-level index
 * shifts by one when the source opens with it (lib/story/edit-compose).
 */
function boundByName(nodes: JsxNode[]): Map<string, BoundEmbed[]> {
  const out = new Map<string, BoundEmbed[]>();
  const offset = helmetOffset(nodes);
  const walk = (node: JsxNode, path: string) => {
    if (node.type !== 'element') return;
    for (const attr of node.attributes) {
      if (!BINDING_ATTRS.has(attr.name) || !attr.value.static || typeof attr.value.json !== 'string') continue;
      const name = refName(attr.value.json.trim());
      if (!name) continue;
      const list = out.get(name) ?? [];
      list.push({ tag: node.tag, label: staticString(node, 'title'), path });
      out.set(name, list);
    }
    node.children.forEach((child, i) => walk(child, `${path}.${i}`));
  };
  nodes.forEach((node, i) => { if (i >= offset) walk(node, String(i - offset)); });
  return out;
}

/**
 * The artifact a query reads from: the connected database it runs inside, or
 * the first import its compiled record says it reads (what it reads is the
 * compiler's answer — the notebook never reads SQL). Null before a compile.
 */
const sourceOf = (q: QueryDecl, compiled: CompiledDataflow | null | undefined): string | null => {
  if (q.source) return q.source;
  const first = compiled?.queries.find((c) => c.name === q.name)?.reads.imports[0];
  return first ? compiled!.imports.find((i) => i.name === first)?.ref ?? null : null;
};

const cellOf = (q: QueryDecl, state: DataflowState | null | undefined, pending: boolean, bound: BoundEmbed[], compiled: CompiledDataflow | null | undefined): QueryCell => ({
  name: q.name,
  sql: q.sql,
  source: sourceOf(q, compiled),
  result: state?.tables[q.name] ?? null,
  error: state?.errors?.[q.name] ?? null,
  pending,
  bound,
});

/** The document's `<Query>` declarations in authored order, each with its last-run state and what reads it. */
export function queryCells(source: string, state: DataflowState | null | undefined, pending = false, compiled?: CompiledDataflow | null): QueryCell[] {
  const parsed = parseJsx(source);
  if (!parsed.ok) return [];
  const bound = boundByName(parsed.nodes);
  return splitHelmet(parsed.nodes).content.queries.map((q) => cellOf(q, state, pending, bound.get(q.name) ?? [], compiled));
}

/** The `<Query name>` element among the Helmet's children, where declarations live. */
function findQuery(nodes: JsxNode[], name: string): JsxElement | null {
  for (const node of nodes) {
    if (node.type !== 'element' || !node.isComponent || node.tag !== HELMET_TAG) continue;
    for (const child of node.children) {
      if (child.type === 'element' && child.tag === QUERY_TAG && staticString(child, 'name') === name) return child;
    }
  }
  return null;
}

/**
 * Replace the SQL of the `<Query name>` declaration, leaving everything else as
 * it was. The source comes back UNCHANGED when it does not parse, no such
 * query exists, the SQL is blank, or nothing would change — a stale cell must
 * never corrupt a document (the updateJsxElementAtPath rule).
 */
export function updateQuerySqlInJsx(source: string, name: string, sql: string): string {
  if (sql.trim() === '') return source;
  const parsed = parseJsx(source);
  if (!parsed.ok) return source;
  const el = findQuery(parsed.nodes, name);
  const kid = el?.children.find((c) => c.type === 'expression');
  if (!kid || kid.type !== 'expression' || !kid.value.static || typeof kid.value.json !== 'string') return source;
  if (kid.value.json === sql) return source;
  // The serializer emits a static string child as a template literal, escaped — the same
  // path every other structural edit takes, so backticks and `${` in SQL survive.
  kid.value = { static: true, json: sql };
  return serializeJsx(parsed.nodes);
}

import { deckColumns, GEOMETRY_COLUMN } from '@/lib/viz/deck-spec';
/**
 * The document's DATA checks — everything about a markup document's data that
 * can only be judged with the caller's artifacts in hand: refs resolve and are
 * the right kind (lib/story/refs.ts), the declarations COMPILE against the
 * real shapes of what they import (lib/story/compile-dataflow — which also
 * checks the markup that binds them), every written dataset is the
 * publisher's to write and admits the write under its data policy, and every
 * chart bound to a query is checked against that query's RESULT columns —
 * vega encodings and recipe slots alike. ONE function, so the publish door
 * (jsx-tier) and the refresh path (a dataset changed → which dependents
 * broke?) cannot drift apart.
 */
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { isQueryFailure, runMutation } from '@/lib/sql/engine';
import { placeholderSession, viewerMutationPolicy } from '@/lib/datasets/policy/viewer-policy';
import { datasetSqlParams } from '@/lib/datasets/sql';
import { importedTables } from '@/lib/datasets/catalog';
import { refName, isEmptyDataflow } from './dataflow';
import type { DatasetColumn } from './dataset-shape';
import { dataflowOf, splitHelmet } from './helmet';
import { refId, validateRecipeUse, validateRefs, validateVizAgainstColumns, writeRefusal, type RefLoader, type ResolvedRef } from './refs';
import { compileDataflow, prepareCompile, type ImportSource, type SchemaLoader } from './compile-dataflow';
import type { CompiledDataflow } from './compiled-dataflow';
import { bindParams, bindTypes, importRef, mutationParams, mutationReads, valueTypes } from './compiled-flow';
import { getTemplate, VIZ_TEMPLATES } from '@/lib/viz/viz-templates';
import { normalize, type TopLevelSpec } from 'vega-lite';

type DataCheckResult =
  | { ok: true; refs: Array<{ id: string; kind: string }>; compiled: CompiledDataflow | null }
  | { ok: false; error: 'invalid_refs' | 'invalid_sql'; details: string[] };

/** What an artifact is to the compiler: a dataset's tables, a folder's listing, or a database to run inside. */
export function schemaSourceOf(r: ResolvedRef | null): ImportSource | null {
  if (!r) return null;
  if (r.format === 'folder') return { kind: 'folder', tables: [{ name: 'rows', columns: r.columns ?? [] }] };
  if (r.format !== 'dataset') return null;
  if (r.catalog?.kind === 'postgres') {
    const query = r.query;
    return { kind: 'postgres', tables: [], ...(query ? { probe: async (sql, params, types) => ({ columns: (await query(sql, params, types)).columns, params: datasetSqlParams(sql) }) } : {}) };
  }
  return { kind: 'dataset', tables: r.catalog ? importedTables(r.catalog).map((t) => ({ name: t.name, columns: t.columns })) : [{ name: 'rows', columns: r.columns ?? [] }] };
}

/** The compiler's loader over a ref loader. */
export const schemaLoaderFor = (load: RefLoader): SchemaLoader => async (ref) => schemaSourceOf(await load(ref));

export async function checkDocumentData(source: string, load: RefLoader): Promise<DataCheckResult> {
  const checked = await validateRefs(source, load);
  if (!checked.ok) return { ok: false, error: 'invalid_refs', details: checked.details };

  const parsed = parseJsx(source);
  if (!parsed.ok) return { ok: true, refs: checked.refs, compiled: null };
  const split = splitHelmet(parsed.nodes);
  const flow = dataflowOf(split.content);
  if (isEmptyDataflow(flow)) return { ok: true, refs: checked.refs, compiled: null };

  const compiled = compileDataflow(flow, await prepareCompile(flow, schemaLoaderFor(load)), split.body);
  if (!compiled.ok) return { ok: false, error: 'invalid_sql', details: compiled.errors.map((e) => e.message) };
  const writes = await admitWrites(compiled.compiled, load);
  // Who may write the dataset at all is a reference's question; what the policy admits is the statement's.
  if (writes.refs.length) return { ok: false, error: 'invalid_refs', details: writes.refs };
  if (writes.sql.length) return { ok: false, error: 'invalid_sql', details: writes.sql };
  const columns = Object.fromEntries(compiled.compiled.queries.map((q) => [q.name, q.columns.map((c) => ({ name: c.name, type: c.type ?? 'string' }) as DatasetColumn)]));
  const bindings = await validateQueryBindings(split.body, columns, load);
  if (bindings.length) return { ok: false, error: 'invalid_refs', details: bindings };
  return { ok: true, refs: checked.refs, compiled: compiled.compiled };
}

/**
 * Every mutation that writes a dataset: the publisher may write it (refs
 * `writeRefusal`), and — where it carries a data policy — the policy admits
 * the statement. That second half is THE CLICK'S OWN ANALYSIS, AT THE DOOR:
 * the same engine and policy a click uses, under the same declared typing
 * (each argument and built-in a NULL of its type), analysis only
 * (`policyPreview`) against the empty table. A value-dependent refusal cannot
 * be seen from here; a statement the policy never admits is the publisher's
 * 400, not every viewer's 403.
 */
async function admitWrites(flow: CompiledDataflow, load: RefLoader): Promise<{ refs: string[]; sql: string[] }> {
  const refs: string[] = [];
  const out: string[] = [];
  const types = valueTypes(flow);
  for (const m of flow.mutations) {
    if (!('import' in m.target)) continue;
    const r = await load(importRef(flow, m.target.import) ?? '');
    const refusal = r ? writeRefusal(r) : 'the dataset does not resolve';
    if (refusal) { refs.push(`<Mutation name="${m.name}">: ${refusal}`); continue; }
    if (!r?.datasetPolicy || !r.catalog) continue;
    const table = importedTables(r.catalog).find((t) => t.name === (m.target as { table: string }).table);
    if (!table) { out.push(`<Mutation name="${m.name}">: the dataset has no stored table ${m.target.table}`); continue; }
    const policy = viewerMutationPolicy(r.datasetPolicy, table, placeholderSession(r.datasetPolicy));
    if (!policy) { out.push(`<Mutation name="${m.name}">: Dataset policy: no policy permits writes to ${table.schema}.${table.name}`); continue; }
    const params = mutationParams(m);
    const result = await runMutation({
      table: { schema: m.target.import, name: table.name, rows: [], columns: table.columns }, sql: m.sql, reads: mutationReads(flow, m, {}),
      params: bindParams(params, {}), paramTypes: bindTypes(params, { ...types, ...Object.fromEntries(m.args.map((a) => [a.name, a.type])) }),
      policy, policyPreview: true,
    });
    if (isQueryFailure(result)) out.push(`<Mutation name="${m.name}">: ${result.error}`);
  }
  return { refs, sql: out };
}

/** The message Vega-Lite's normaliser throws for a spec it cannot read, or null for one it can read. */
export function vegaLiteStructureError(spec: Record<string, unknown>): string | null {
  // The platform binds the query's rows to the chart; a spec that names or inlines its own data set
  // normalises fine and then fails in the browser ("Unrecognized data set: table" — a local pi deck).
  if ('data' in spec) return 'the spec carries a "data" key; the platform binds the query rows to the chart — remove it';
  try { normalize(structuredClone(spec) as unknown as TopLevelSpec); return null; }
  catch (error) { return error instanceof Error ? error.message : String(error); }
}

/** Every `<Question data="$q" viz>` checked against q's result columns (encodings, or recipe slots). */
async function validateQueryBindings(body: JsxNode[], columns: Record<string, DatasetColumn[]>, load: RefLoader): Promise<string[]> {
  const out: string[] = [];
  const questions: Array<{ name: string; viz: Record<string, unknown> }> = [];
  const visit = (nodes: JsxNode[]) => {
    for (const n of nodes) {
      if (n.type !== 'element') continue;
      if (n.isComponent && n.tag === 'DeckGL') {
        const data = n.attributes.find((a) => a.name === 'data')?.value;
        const layers = n.attributes.find((a) => a.name === 'layers')?.value;
        const name = data?.static ? refName(data.json) : null;
        if (name && columns[name] && layers?.static) {
          const known = new Set(columns[name].map((c) => c.name));
          for (const col of deckColumns(layers.json)) {
            if (!known.has(col)) out.push(`query $${name}: DeckGL reads column "${col}", which the query does not return${col === GEOMETRY_COLUMN ? ' (a GeoJsonLayer without data draws each row\'s geometry column — add your GeoJSON as a dataset, or use data "boundary:<id>")' : ''}`);
          }
        }
      }
      if (n.isComponent && n.tag === 'Question') {
        const data = n.attributes.find((a) => a.name === 'data')?.value;
        const viz = n.attributes.find((a) => a.name === 'viz')?.value;
        const name = data?.static ? refName(data.json) : null;
        if (name && columns[name] && viz?.static && viz.json && typeof viz.json === 'object' && !Array.isArray(viz.json)) {
          questions.push({ name, viz: viz.json as Record<string, unknown> });
        }
      }
      visit(n.children);
    }
  };
  visit(body);
  for (const { name, viz } of questions) {
    // STRUCTURE FIRST, with Vega-Lite's own normaliser, HERE and not in refs.ts: this module is
    // server-only, while refs.ts is bundled into afbin for `afbin validate` and vega-lite is
    // ESM-with-top-level-await that the CJS binary build refuses. A spec the normaliser rejects (a
    // top-level `facet` beside `mark`/`encoding`, where it wants a `spec` wrapper) passes every field
    // check and throws in the reader's browser instead — "Cannot destructure property 'transform'
    // of 'spec'" on a dashboard tile. Refused before publish.
    const structural = viz.kind === 'vega-lite' && viz.spec && typeof viz.spec === 'object' ? vegaLiteStructureError(viz.spec as Record<string, unknown>) : null;
    if (structural) { out.push(`query $${name}: viz is not a Vega-Lite spec the renderer can read — ${structural}`); continue; }
    out.push(...validateVizAgainstColumns(viz, columns[name], `query $${name}`));
    const recipeRef = viz.kind === 'recipe' && typeof viz.recipe === 'string' ? viz.recipe : null;
    if (recipeRef) {
      const recipeId = refId(recipeRef);
      if (recipeId) {
        const recipe = (await load(recipeId))?.recipe;
        if (recipe) out.push(...validateRecipeUse(viz, recipe, columns[name], `ref:${recipeId}`));
      } else {
        // A SHIPPED registry recipe (minusx/trend@1, …): same slot checks,
        // against the template's own declared bindings. An unknown id is a
        // publish error naming the shipped set — publishing it would render
        // a fallback the author only discovers by looking.
        const template = getTemplate(recipeRef);
        if (!template) {
          out.push(`viz recipe "${recipeRef}" is neither a ref:<vizId> viz artifact nor a shipped recipe (shipped: ${Object.keys(VIZ_TEMPLATES).join(', ')})`);
        } else {
          out.push(...validateRecipeUse(viz, { bindings: template.bindings.map((b) => ({ ...b, accepts: [...b.accepts] })) }, columns[name], recipeRef));
        }
      }
    }
  }
  return out;
}

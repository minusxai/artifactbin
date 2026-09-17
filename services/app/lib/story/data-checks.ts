import {resolveUserValues} from './user-values';
import {compileStoredMutation} from '@/lib/datasets/stored-mutation';
/**
 * The document's DATA checks — everything about a markup document's data that
 * can only be judged with the caller's artifacts in hand: refs resolve and are
 * the right kind (lib/story/refs.ts), every <Query> prepares against the real
 * dataset shapes (the engine dry run), and every chart bound to a query is
 * checked against that query's RESULT columns — vega encodings and recipe
 * slots alike. ONE function, so the publish door (jsx-tier) and the refresh path
 * (a dataset changed → which dependents broke?) cannot drift apart.
 */
import { analyzeRowScopes, mutationUsesRow, mutationUsesValue } from './row-scope';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { dryRunMutations, dryRunQueries, isQueryFailure, runMutation } from '@/lib/sql/engine';
import { placeholderSession, viewerMutationPolicy } from '@/lib/datasets/policy/viewer-policy';
import type { DatasetMutationPolicy } from '@artifactbin/contracts';
import { mutationsOf, queryOrder, refName, scalarParamTypes, type Dataflow } from './dataflow';
import { SIGNALS_TABLE } from './local-target';
import type { DatasetColumn } from './dataset-shape';
import { splitHelmet } from './helmet';
import { refId, validateRecipeUse, validateRefs, validateVizAgainstColumns, type RefLoader } from './refs';
import { getTemplate, VIZ_TEMPLATES } from '@/lib/viz/viz-templates';
import { normalize, type TopLevelSpec } from 'vega-lite';

type DataCheckResult =
  | { ok: true; refs: Array<{ id: string; kind: string }> }
  | { ok: false; error: 'invalid_refs' | 'invalid_sql'; details: string[] };

export async function checkDocumentData(source: string, load: RefLoader): Promise<DataCheckResult> {
  const checked = await validateRefs(source, load);
  if (!checked.ok) return { ok: false, error: 'invalid_refs', details: checked.details };

  const parsed = parseJsx(source);
  if (!parsed.ok) return { ok: true, refs: checked.refs };
  const split = splitHelmet(parsed.nodes);
  const flow: Dataflow = { values: split.content.values, queries: split.content.queries, mutations: split.content.mutations };
  if (flow.queries.length === 0 && mutationsOf(flow).length === 0 && !flow.values.some(v=>v.kind==='scalar'&&v.source)) return { ok: true, refs: checked.refs };

  const dry = await dryRunDataflow(flow, load, split.body);
  if (dry.kind === 'sql') return { ok: false, error: 'invalid_sql', details: dry.details };
  const bindings = await validateQueryBindings(split.body, dry.columns, load);
  if (bindings.length) return { ok: false, error: 'invalid_refs', details: bindings };
  return { ok: true, refs: checked.refs };
}

/** Prepare every query against the shapes its refs resolve to. */
export async function dryRunDataflow(flow: Dataflow, load: RefLoader, body: JsxNode[] = []): Promise<
  | { kind: 'sql'; details: string[] }
  | { kind: 'ok'; columns: Record<string, DatasetColumn[]>; rowSchemas: Record<string, DatasetColumn[]> }
> {
  try {flow=await resolveUserValues(flow,load);}catch(error){return {kind:'sql',details:[error instanceof Error?error.message:'Invalid user binding']};}
  const tables: Record<string, { columns: DatasetColumn[] }> = {};
  for (const v of flow.values) if (v.kind === 'table') tables[v.name] = { columns: v.columns };
  const signalColumns = flow.values.filter(v => v.kind === 'scalar').map(v => ({name: v.name, type: v.type}));
  if (signalColumns.length) tables[SIGNALS_TABLE] = {columns: signalColumns};
  const mutations = mutationsOf(flow);
  const paramNames = [...flow.values.filter((v) => v.kind === 'scalar').map((v) => v.name),'_me'];
  const paramTypes = scalarParamTypes(flow);
  const order = queryOrder(flow) ?? [];
  const queries = order.map((n) => flow.queries.find((q) => q.name === n)!);
  const sourceErrors:string[]=[];
  for(const query of queries.filter(q=>q.source)){
    try{
      const ref=await load(query.source!);if(!ref?.query)throw new Error('Dataset source is unavailable');
      const params={...Object.fromEntries(flow.values.filter(v=>v.kind==='scalar').map(v=>[v.name,v.default])),_me:null};
      tables[query.name]={columns:(await ref.query(query.sql,params,paramTypes)).columns};
    }catch(error){sourceErrors.push(`<Query name="${query.name}">: ${error instanceof Error?error.message:'Dataset query failed'}`);}
  }
  const dry = await dryRunQueries({ tables, queries:queries.filter(q=>!q.source), paramNames });
  const details = [...sourceErrors,...dry.errors.map((e) => `<Query name="${e.name}">: ${e.error}`)];
  const columns = { ...Object.fromEntries(Object.entries(tables).map(([n, t]) => [n, t.columns])), ...dry.columns };
  const scoped = analyzeRowScopes(body, columns);
  details.push(...scoped.errors);
  const rowSchemas: Record<string, DatasetColumn[]> = {};
  for (const name of Object.keys(scoped.mutationTables)) {
    const mutation = mutations.find((m) => m.name === name);
    if (mutation && !mutationUsesRow(mutation.sql)) details.push(`Row run="$${name}" requires a row mutation using $_row or $_value`);
  }
  for (const mutation of mutations) {
    if (scoped.actionMutations.has(mutation.name) && mutationUsesValue(mutation.sql)) details.push(`row action "${mutation.name}" cannot use $_value; use $_row fields or declared Values`);
    if (!mutationUsesRow(mutation.sql)) continue;
    const names = scoped.mutationTables[mutation.name] ?? [];
    const shapes = names.map((n) => columns[n]).filter((c): c is DatasetColumn[] => !!c);
    if (!shapes.length) details.push(`row mutation "${mutation.name}" must be invoked inside a DataTable Column or keyed For`);
    else if (shapes.some((s) => JSON.stringify(s) !== JSON.stringify(shapes[0]))) details.push(`row mutation "${mutation.name}" has incompatible table scopes`);
    else rowSchemas[mutation.name] = shapes[0];
  }
  // Every <Mutation> prepares and executes against its (empty) target too —
  // a non-DML statement or an unknown column is a publish error, never a
  // button that fails on its first click.
  if (mutations.length) {
    const groups=mutations.some(m=>m.source)?mutations.map(m=>[m]):[mutations];
    const policed:PolicedMutation[]=[];
    for(const group of groups){
      const inputTables={...tables};const prepared=[];
      for(const m of group){
        let sql=m.sql;
        if(m.source){try{const ref=await load(m.source);if(!ref?.catalog)throw new Error('Dataset source is unavailable');const compiled=compileStoredMutation(ref.catalog,sql,'dataset_rows');sql=compiled.sql;inputTables.dataset_rows={columns:compiled.table.columns};
          if(ref.datasetPolicy){
            const policy=viewerMutationPolicy(ref.datasetPolicy,compiled.table,placeholderSession(ref.datasetPolicy));
            if(!policy)throw new Error(`Dataset policy: no policy permits writes to ${compiled.table.schema}.${compiled.table.name}`);
            // A row action with no row to bind has ALREADY been named above ("must be invoked inside…").
            // Planning `$_row.id` with no struct behind it only adds the engine's own crash text to that answer.
            if(!mutationUsesRow(m.sql)||rowSchemas[m.name])policed.push({name:m.name,sql,columns:compiled.table.columns,policy,...(rowSchemas[m.name]?{row:rowSchemas[m.name]}:{})});
          }
        }catch(error){details.push(`<Mutation name="${m.name}">: ${error instanceof Error?error.message:'Invalid mutation'}`);continue;}}
        prepared.push({...m,sql,tableName: m.scope === 'local' ? m.target : 'dataset_rows',...(rowSchemas[m.name]?{row:{columns:rowSchemas[m.name]}}:{})});
      }
      if(prepared.length){const wet=await dryRunMutations({tables:inputTables,mutations:prepared,paramNames:[...paramNames,'_value','_me'],paramTypes});details.push(...wet.errors.map(e=>`<Mutation name="${e.name}">: ${e.error}`));}
    }
    details.push(...await policyRefusals(policed,[...paramNames,'_value'],paramTypes));
  }
  if (details.length) return { kind: 'sql', details };
  return { kind: 'ok', columns, rowSchemas };
}

interface PolicedMutation {
  name: string;
  sql: string;
  columns: DatasetColumn[];
  policy: DatasetMutationPolicy;
  /** The shape of `$_row` where the button sits inside a row scope. */
  row?: DatasetColumn[];
}

/**
 * THE CLICK'S OWN ANALYSIS, AT THE DOOR. A `<Mutation>` against a dataset that
 * carries a data policy is analyzed here with the same engine and the same
 * policy a click uses, and — this is what makes it predictive — under the same
 * TYPING: each scalar is a NULL placeholder of its DECLARED type, `$_row` a
 * typed struct of the row scope's columns. The bindings are still empty, so
 * this is not "exactly the write door" (a value-dependent refusal cannot be
 * seen from here), but a type clash is, because the plan no longer depends on
 * what a reader happens to have typed. `coalesce($due, current_date)` on a
 * `date` Value analyzed as VARCHAR is the publisher's 400 naming the mutation,
 * not a 403 for every viewer who picks a date.
 *
 * `_value` has no declared type here (the edited cell's column is not tracked
 * per mutation), so it keeps the engine's value-based inference.
 *
 * Analysis ONLY (`policyPreview`): nothing is written, and the target table is
 * empty, so this costs one throwaway instance per policed mutation.
 */
async function policyRefusals(mutations: PolicedMutation[], paramNames: string[], paramTypes: Record<string, DatasetColumn['type']>): Promise<string[]> {
  const out: string[] = [];
  const params = Object.fromEntries(paramNames.map((n) => [n, null]));
  for (const m of mutations) {
    const result = await runMutation({
      table: { name: 'dataset_rows', rows: [], columns: m.columns },
      sql: m.sql,
      params,
      paramTypes,
      policy: m.policy,
      policyPreview: true,
      ...(m.row ? { row: { columns: m.row, values: {} } } : {}),
    });
    if (isQueryFailure(result)) out.push(`<Mutation name="${m.name}">: ${result.error}`);
  }
  return out;
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

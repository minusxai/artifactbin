/**
 * The document's DATA checks — everything about a markup document's data that
 * can only be judged with the caller's artifacts in hand: refs resolve and are
 * the right kind (lib/story/refs.ts), every <Query> prepares against the real
 * dataset shapes (the engine dry run), and every chart bound to a query is
 * checked against that query's RESULT columns — vega encodings and recipe
 * slots alike — exactly as a `ref:` chart used to be checked against its
 * dataset. ONE function, so the publish door (jsx-tier) and the refresh path
 * (a dataset changed → which dependents broke?) cannot drift apart.
 */
import { analyzeRowScopes, mutationUsesRow } from './row-scope';
import { parseJsx, type JsxNode } from '@/lib/jsx';
import { dryRunMutations, dryRunQueries } from '@/lib/sql/engine';
import { mutationsOf, queryOrder, refName, type Dataflow } from './dataflow';
import type { DatasetColumn } from './dataset-shape';
import { splitHelmet } from './helmet';
import { refId, validateRecipeUse, validateRefs, validateVizAgainstColumns, type RefLoader } from './refs';
import { getTemplate, VIZ_TEMPLATES } from '@/lib/viz/viz-templates';

export type DataCheckResult =
  | { ok: true; refs: Array<{ id: string; kind: string }> }
  | { ok: false; error: 'invalid_refs' | 'invalid_sql'; details: string[] };

export async function checkDocumentData(source: string, load: RefLoader): Promise<DataCheckResult> {
  const checked = await validateRefs(source, load);
  if (!checked.ok) return { ok: false, error: 'invalid_refs', details: checked.details };

  const parsed = parseJsx(source);
  if (!parsed.ok) return { ok: true, refs: checked.refs };
  const split = splitHelmet(parsed.nodes);
  const flow: Dataflow = { values: split.content.values, queries: split.content.queries, mutations: split.content.mutations };
  if (flow.queries.length === 0 && mutationsOf(flow).length === 0) return { ok: true, refs: checked.refs };

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
  const tables: Record<string, { columns: DatasetColumn[] }> = {};
  for (const v of flow.values) if (v.kind === 'table') tables[v.name] = { columns: v.columns };
  const mutations = mutationsOf(flow);
  for (const id of new Set([...flow.queries.flatMap((q) => q.refs), ...mutations.map((m) => m.target)])) {
    const r = await load(id);
    // A folder registers the FIXED shape of its children table (lib/folders
    // CHILDREN_COLUMNS), which `rowToResolvedRef` already put on the ref — so
    // the dry run judges a folder's <Query> against the same columns the run
    // will really see.
    if (r?.format === 'dataset' || r?.format === 'folder') tables[`ref_${id}`] = { columns: r.columns ?? [] };
  }
  const paramNames = flow.values.filter((v) => v.kind === 'scalar').map((v) => v.name);
  const order = queryOrder(flow) ?? [];
  const queries = order.map((n) => flow.queries.find((q) => q.name === n)!);
  const dry = await dryRunQueries({ tables, queries, paramNames });
  const details = dry.errors.map((e) => `<Query name="${e.name}">: ${e.error}`);
  const columns = { ...Object.fromEntries(Object.entries(tables).map(([n, t]) => [n, t.columns])), ...dry.columns };
  const scoped = analyzeRowScopes(body, columns);
  details.push(...scoped.errors);
  const rowSchemas: Record<string, DatasetColumn[]> = {};
  for (const name of Object.keys(scoped.mutationTables)) {
    const mutation = mutations.find((m) => m.name === name);
    if (mutation && !mutationUsesRow(mutation.sql)) details.push(`Column run="$${name}" requires a row mutation using $_row or $_value`);
  }
  for (const mutation of mutations) {
    if (!mutationUsesRow(mutation.sql)) continue;
    const names = scoped.mutationTables[mutation.name] ?? [];
    const shapes = names.map((n) => columns[n]).filter((c): c is DatasetColumn[] => !!c);
    if (!shapes.length) details.push(`row mutation "${mutation.name}" must be invoked inside a DataTable Column`);
    else if (shapes.some((s) => JSON.stringify(s) !== JSON.stringify(shapes[0]))) details.push(`row mutation "${mutation.name}" has incompatible table scopes`);
    else rowSchemas[mutation.name] = shapes[0];
  }
  // Every <Mutation> prepares and executes against its (empty) target too —
  // a non-DML statement or an unknown column is a publish error, never a
  // button that fails on its first click.
  if (mutations.length) {
    const wet = await dryRunMutations({ tables, mutations: mutations.map((m) => ({ ...m, ...(rowSchemas[m.name] ? { row: { columns: rowSchemas[m.name] } } : {}) })), paramNames: [...paramNames, '_value'] });
    details.push(...wet.errors.map((e) => `<Mutation name="${e.name}">: ${e.error}`));
  }
  if (details.length) return { kind: 'sql', details };
  return { kind: 'ok', columns, rowSchemas };
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

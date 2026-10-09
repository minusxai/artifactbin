import { canReadArtifact, canWriteDataset, ownerScope, ownsArtifact, type ArtifactRow, type RoleActor, type Scope, type TokenActor, type WriteRefusal, writerFor } from './access';
import { getArtifact, getArtifactById, getArtifactByUser, getArtifactFor, getLinkReadableArtifact, refLoaderFor, refLoaderForUser } from './store';
import { executeDocumentQueries, executeDocumentQueriesMany, type DocumentQuerySourceMode } from '../sql/document-queries';
import { artifactQuery } from './document';
import { JOIN_RELATIONS } from '../accounts/relation-state';
import { grantContext, grantsOf, grantsPermitRead } from '../datasets/policy/grants';
import { storedMediaReferences } from '../datasets/media-references';
import { isQueryFailure, SIGN_IN_REQUIRED, type PersonCard } from '@artifactbin/contracts';
import type { DataflowState } from '@/lib/dataflow';
import { validateUserWrites, userOptions, people } from '@/lib/datasets/user-fields';
import { can, refusalFor, type CapabilityActor, type CapabilityRefusal } from './capabilities';
import { pinMutationContext, type MutationReceipt } from './mutation-receipt';
import { notificationContextSnapshot } from '../notifications/context';
import type { MutationNotificationJobInput, MutationInitiator } from '@artifactbin/contracts';
import { catalogOf } from '@/lib/datasets/catalog';
import { executeCatalog } from '@/lib/datasets/execute';
import { DatasetError } from '@/lib/datasets/errors';
import { getDb } from '../platform/db';
import type { DatasetAccessPolicy as DatasetPolicy } from '@artifactbin/contracts';
import { parseDatasetAccessPolicy } from '@artifactbin/utils';
import { imageRawUrl, imageRefData, pdfRawUrl } from '@/lib/dataflow/ref-data';
import { displayTitle } from '../document/title';
import { readCompiledDataflow } from '@/lib/document/server';
import { EMPTY_DATAFLOW, isEmptyDataflow, type QueryDecl, type Row, type Scalar } from '@/lib/dataflow/dataflow';
import { EMPTY_COMPILED_DATAFLOW, type CompiledDataflow, type CompiledMutation } from '@/lib/dataflow/compiled-dataflow';
import { compileWithLoader, type CompileResult } from '@/lib/dataflow/compile-dataflow';
import { declarationsOf } from '@/lib/document/helmet';
import type { ValidationError } from '@/lib/jsx';
import { bindParams, bindTypes, dataRefs, importRef, initialTables, initialValues, mutationParams, mutationReads, mutationTargetRef, selectQueries, type ImportTables } from '@/lib/dataflow/compiled-flow';
import { bindMutationRequest } from '@/lib/dataflow/mutation-request';
import { HOLD_MAX_BYTES, HOLD_MAX_ROWS } from '@/lib/dataflow/placement';
import { readerZone, VIEWER, VIEWER_ID } from '@/lib/dataflow/builtins';
import type { MutationRequest } from '@/lib/dataflow';
import { schemaLoaderFor, type ServerRef, type ServerRefLoader } from '@/lib/datasets/schema-loader';
import { mutationPolicy } from '@/lib/datasets/policy';
import { isMutationRefused, mutateDataset } from './write/dataset-mutate';
import { runMutation } from '@/lib/sql/engine';
import { sqlExtensions } from '@/lib/sql/extensions';
import { runLocalStateMutation, type LocalMutationResult } from '@/lib/dataflow/local-state';
import { localTableOverrides } from '@/lib/dataflow/local-tables';
import { importedRows, importedTables } from '@/lib/datasets/catalog';
import { storedRowStats } from '@/lib/datasets/dataset-store';
import { childrenTableFor, CHILDREN_COLUMNS } from '@/lib/workspace/folders';
import type { RanDataflow, StoryIslandDataflow, StoryViewer } from '@/lib/story-runtime/contract';
import type { DatasetColumn } from '@/lib/dataflow/dataset-shape';
import { checkDocumentData } from '@/lib/story/data/data-checks';

export function refLoaderForActor(actor: TokenActor): ServerRefLoader {
  return actor.userId ? refLoaderForUser(actor.userId) : refLoaderFor(actor.tokenId);
}

/** A stored policy the publish door can analyze against, or nothing at all:
 * an unreadable policy is the write door's refusal to make, not a publish's. */
function parsedDatasetPolicy(row: ArtifactRow): DatasetPolicy | undefined {
  if (!row.dataset_policy) return undefined;
  try { return parseDatasetAccessPolicy(row.dataset_policy); } catch { return undefined; }
}

export function rowToResolvedRef(row: ArtifactRow, owned = false): ServerRef {
  const meta = (row.meta ?? {}) as { columns?: DatasetColumn[] };
  const catalog = row.format === 'dataset' ? catalogOf(row) : null;
  return {
    id: row.id,
    format: row.format,
    validationState:{id:row.id,version:row.version,sharingRevision:row.sharing_revision??0,policyRevision:row.policy_revision??0},
    owned,
    ...(row.format === 'dataset' ? { columns: meta.columns ?? [], access: row.access, catalog:catalog??undefined, datasetPolicy:parsedDatasetPolicy(row), query: async(sql:string,params:Record<string,Scalar>,paramTypes?:Record<string,DatasetColumn["type"]>) => {
      if(!catalog)throw new DatasetError(`Dataset source ref:${row.id} has no catalog or stored object key`);
      return executeCatalog(catalog,sql,params,{datasetId:row.id,limit:1,refresh:true,paramTypes});
    } } : {}),
    // A folder's shape is FIXED and computed, never stored — the compiler needs
    // it to judge a <Query> over an <Import> of the folder (`<name>.rows`).
    ...(row.format === 'folder' ? { columns: CHILDREN_COLUMNS } : {}),
    ...(row.format === 'viz' ? { recipe: JSON.parse(row.source ?? '') } : {}),
  };
}

/**
 * Run one of a stored document's declared mutations. Everything a reader
 * supplies is scalar VALUES; the SQL and the target come from the stored
 * source, so a caller can never write anything the author did not publish.
 */
type DocumentMutationOutcome =
  | { ok: true; dataset: ArtifactRow; affected: number; rowCount: number; mutationRunId?: string }
  | { ok: true; local: LocalMutationResult }
  | {
      ok: false;
      reason: 'operation_key_required' | 'policy_denied' | 'unknown_mutation' | WriteRefusal | 'dataset_full' | 'invalid_sql' | 'contended' | 'row_changed' | 'row_not_unique' | 'invalid_row';
      detail?: string;
      /** The machine-readable half of the one refusal a reader can act on (@artifactbin/contracts sign-in-required). */
      code?: typeof SIGN_IN_REQUIRED;
      /**
       * The KIND was refused, not the statement: a guest or a test user that
       * may not write `$_me` at all. The door answers this verbatim — its own
       * status and its own top-level `error` — because "sign in" and "you are
       * outside your sandbox" are answers about the CALLER, not verdicts about
       * the data (lib/capabilities).
       */
      capability?: CapabilityRefusal;
    };

export async function runDocumentMutation(
  doc: ArtifactRow,
  request: MutationRequest,
  actor: RoleActor = {userId:null,tokenId:null},
  receipt?: MutationReceipt,
): Promise<DocumentMutationOutcome> {
  if (doc.format !== 'markup' || !doc.source) return { ok: false, reason: 'unknown_mutation' };
  const compiled = await compileResultForRow(doc);
  // A document whose data does not compile runs nothing, and says why.
  if (compiled && !compiled.ok) return { ok: false, reason: 'invalid_sql', detail: compileErrorText(compiled.errors) };
  const flow = compiled?.compiled ?? null;
  const m = flow?.mutations.find((x) => x.name === request.mutation);
  if (!flow || !m) return { ok: false, reason: 'unknown_mutation' };
  const notificationRules=flow.notifications?.filter(rule=>rule.on===m.name)??[];
  if(notificationRules.length){
    if(!actor.userId&&!actor.tokenId)return {ok:false,reason:'policy_denied',code:SIGN_IN_REQUIRED,detail:'Sign in to run actions with notifications'};
    if(!receipt?.runId)return {ok:false,reason:'operation_key_required',detail:'Preserve an operation key for this action and its retries'};
  }


  /*
   * THE GUEST IS ANSWERED FIRST — before the shape of the call is judged.
   *
   * A statement that reads the viewer has one honest answer for a signed-out
   * caller, and it is a door (@artifactbin/contracts sign-in-required). A ROW action that
   * reads it — a membership button a `<For>` draws for exactly the people who
   * have not joined — used to be told its row was missing instead: true,
   * useless, and about the wrong problem. Deciding sign-in here makes the
   * refusal the same whatever shape the press arrives in: a stale tab, an
   * agent posting at the door directly, a row or none.
   *
   * It is the same judgement `mutateDataset` makes for the calls that never
   * come through here, and the same one `mutationAccessFor` previews for the
   * button; this is only about the ORDER the three checks run in.
   */
  const me: CapabilityActor = { userId: actor.userId ?? null, tokenId: actor.tokenId ?? null };
  if (readsViewer(m) && !(await can(me, 'write_as_me', doc))) {
    // ANONYMOUS keeps the answer it always had: there is no identity to refuse,
    // only a statement that needs a person, and the code is what draws the
    // door. A guest or a test user HAS an identity, and the honest answer names
    // it — the sign-in door for one, the sandbox for the other.
    return me.userId
      ? { ok: false, reason: 'policy_denied', detail: '$_me.id writes belong to the person signed in; this credential may not make them here', code: SIGN_IN_REQUIRED, capability: await refusalFor(me, doc.id) }
      : { ok: false, reason: 'policy_denied', detail: '$_me.id requires a logged-in user', code: SIGN_IN_REQUIRED };
  }

  // Resolved by the DOCUMENT's own scope — never the link-readable fallback,
  // which exists for reads. An unresolvable target reads as read-only, which
  // is what it is from here.
  const writer = writerFor(doc);
  const ref = mutationTargetRef(flow, m);
  let dataset: ArtifactRow | null = null;
  if (ref) {
    const candidate = await getArtifactById(ref);
    dataset = candidate && grantsOf(candidate) ? candidate : await getArtifactFor(writer, ref);
    if (!dataset) return { ok: false, reason: 'dataset_read_only' };
    if(grantsOf(dataset)){try{await grantContext(dataset,actor,{id:doc.id,editId:doc.edit_id});}catch(error){return {ok:false,reason:'policy_denied',detail:error instanceof Error?error.message:'Join this artifact to use its actions'};}}
    const refusal = await canWriteDataset(dataset, actor, {id:doc.id,editId:doc.edit_id});
    if (refusal) return { ok: false, reason: refusal };
    if (request.localTables !== undefined) return {ok: false, reason: 'invalid_sql', detail: 'Persistent mutations do not accept local table overrides'};
  }

  // The signature at the door: the same binding the reader's page applies to a write it computes itself.
  const bound = bindMutationRequest(flow, m, request, { userId: actor.userId ?? null, now: new Date().toISOString(), tz: readerZone(request.tz) });
  if (!bound.ok) return bound;
  const { params, paramTypes } = bound;
  const members = m.reads.builtins.includes('_members') ? await acceptedMembers(doc.id) : [];
  const imports = await importsFor(flow, m.reads.imports, datasetResolverForRow(doc, actor));

  if (!dataset) {
    try {
      const tables = localTableOverrides(flow, request.localTables);
      const local = await runLocalStateMutation(flow, m, {tables}, {mutate:async input=>{
        const columns=input.table.columns.map(c=>c.constraints?.memberOf?{...c,constraints:{...c.constraints,memberOf:c.constraints.memberOf.map(ref=>ref==='current'?`ref:${doc.id}`:ref)}}:c);
        const out=await runMutation({...input,table:{...input.table,columns}});
        if(!isQueryFailure(out))await validateUserWrites(await getDb(),columns,out.userWrites??[],actor.userId);
        return out;
      }}, { params, paramTypes, reads: mutationReads(flow, m, { imports, tables, userId: actor.userId ?? null, members }) });
      return {ok: true, local};
    } catch (error) {
      return {ok: false, reason: 'invalid_sql', detail: error instanceof Error ? error.message : 'Local mutation failed'};
    }
  }
  let notificationJob:MutationNotificationJobInput|undefined;
  if(notificationRules.length&&receipt?.runId){
    const snapshot=notificationContextSnapshot(flow);
    const initiator:MutationInitiator=receipt.initiator??{
      principal:actor.tokenId?{kind:'token',id:actor.tokenId}:{kind:'user',id:actor.userId!},
      execution:actor.tokenId?'agent':'human',agentLabel:null,
    };
    notificationJob={
      origin:{mutationRunId:receipt.runId,documentId:doc.id,documentEditId:doc.edit_id,
        documentVersion:doc.version,mutationName:m.name},
      initiator,rules:notificationRules.map(rule=>({name:rule.name,on:rule.on,sql:rule.sql,...(rule.source?{source:rule.source}:{})})),
      bindings:bound.bindings,...snapshot,
    };
    await pinMutationContext(receipt,{documentId:doc.id,documentEditId:doc.edit_id,mutation:m,bindings:bound.bindings,notificationJob});
  }
  const target = m.target as { import: string; table: string };
  const result = await mutateDataset(dataset, actor, m.sql, params, {
    target: { schema: target.import, table: target.table }, paramTypes, reads: mutationReads(flow, m, { imports, userId: actor.userId ?? null, members }),
    expectedAffected: m.expectedAffected, document:{id:doc.id,editId:doc.edit_id}, ...(receipt ? { receipt } : {}),
    ...(notificationJob?{notificationJob}:{}),
  });
  if (isMutationRefused(result)) return { ok: false, reason: result.reason, detail: result.detail, ...(result.code ? { code: result.code } : {}) };
  return { ok: true, dataset: result.row, affected: result.affected, rowCount: result.rowCount, ...(result.mutationRunId?{mutationRunId:result.mutationRunId}:{}) };
}

/** Whether a statement reads the viewer: `$_me.id`, or the one-row `_me` table. */
const readsViewer = (m: { reads: { builtins: string[] } }): boolean => m.reads.builtins.some((b) => b === VIEWER || b === VIEWER_ID);

/** The artifact's accepted members, oldest first — the `_members` table. */
export async function acceptedMembers(artifactId: string): Promise<Row[]> {
  return (await (await getDb()).query<Row>(`SELECT user_id,joined_at::text FROM ${JOIN_RELATIONS} WHERE artifact_id=$1 AND status='accepted' ORDER BY joined_at,user_id`,[artifactId])).rows;
}

/**
 * A document's compiled dataflow as the compiler answers it: the record its
 * publish stored, or — stale, missing, compiled by an older compiler — a fresh
 * compile under the document's own reach (the author's scope, as every read
 * resolves), with the compiler's errors when the source no longer compiles.
 * Null when there is nothing to compile: no source, or a source that does not parse.
 */
async function compileResultForRow(row: CompilableRow): Promise<CompileResult | null> {
  if (!row.source) return null;
  return readCompiledDataflow(row.meta, row.source, schemaLoaderFor(refLoaderForActor(writerFor(row))), { extensions: sqlExtensions() });
}
type CompilableRow = Pick<ArtifactRow, 'id' | 'version' | 'source' | 'meta' | 'token_id' | 'user_id'>;

/** {@link compileResultForRow} for callers that only act on a document that compiles: null otherwise. */
export async function compiledForRow(stored: CompilableRow): Promise<CompiledDataflow | null> {
  const result = await compileResultForRow(stored);
  return result?.ok ? result.compiled : null;
}

/** Compile errors as publish reports them, one per line: each names its declaration. */
const compileErrorText = (errors: ValidationError[]): string => errors.map((e) => e.message).join('\n');

/**
 * The documents in the owner's scope that WRITE this dataset, with the
 * mutations they declare — what the share menu shows beside the toggle, so
 * turning writes off can say what will stop working. Same shape and scope as
 * `findDependents`, narrowed to declared writers.
 */
export async function findWritersFor(actor: TokenActor, datasetId: string): Promise<Array<{ id: string; title: string | null; mutations: string[] }>> {
  const dependents = await findDependentsFor(actor, datasetId);
  const out: Array<{ id: string; title: string | null; mutations: string[] }> = [];
  for (const dep of dependents) {
    if (!dep.source) continue;
    const flow = await compiledForRow(dep);
    const names = (flow?.mutations ?? []).filter((m) => mutationTargetRef(flow!, m) === datasetId).map((m) => m.name);
    if (names.length) out.push({ id: dep.id, title: dep.title, mutations: names });
  }
  return out;
}

/** Current stored dataset cells participate in the same owner-scoped deletion graph.
 * No persisted index: existing datasets and every write path are immediately covered.
 * Errors reading promised objects fail closed, rather than permitting unsafe deletion.
 */
async function findDependentsScoped(scope: Scope, refId: string): Promise<ArtifactRow[]> {
  const db = await getDb();
  const image=(await getArtifactById(refId))?.format==='image';
  const res = await artifactQuery<ArtifactRow>(db,
    `SELECT * FROM artifacts WHERE ${scope.where('$1')} AND ${image ? "format IN ('markup','dataset')" : "format = 'markup' AND meta::text LIKE $2"}`,
    image ? [scope.val] : [scope.val,`%"${refId}"%`],
  );
  const rows=res.rows as unknown as ArtifactRow[];
  const targets=new Set([refId]);
  const found=new Map<string,ArtifactRow>();
  for(const row of rows){
    if(row.format!=='dataset'||row.id===refId)continue;
    if((await storedMediaReferences(row)).has(refId)){targets.add(row.id);found.set(row.id,row);}
  }
  for(const row of rows){
    if(row.format!=='markup'||row.id===refId)continue;
    const refs=(row.meta as {refs?:Array<{id:string}>}).refs??[];
    if(refs.some(ref=>targets.has(ref.id)))found.set(row.id,row);
  }
  return [...found.values()];
}

export function findDependentsFor(actor: TokenActor, refId: string): Promise<ArtifactRow[]> {
  return findDependentsScoped(ownerScope(actor), refId);
}

/**
 * After a dataset/viz refresh: re-run reference validation for every dependent
 * against the NEW content. Warnings, never blocks: a data refresh
 * can't be stopped by a stale chart.
 */
export async function refreshWarningsFor(actor: TokenActor, updated: ArtifactRow): Promise<Array<{ id: string; title: string | null; details: string[] }>> {
  if (updated.format !== 'dataset' && updated.format !== 'viz') return [];
  const dependents = await findDependentsFor(actor, updated.id);
  if (dependents.length === 0) return [];
  const base = refLoaderForActor(actor);
  const load: ServerRefLoader = async (id) => (id === updated.id ? rowToResolvedRef(updated) : base(id));
  const warnings: Array<{ id: string; title: string | null; details: string[] }> = [];
  for (const dep of dependents) {
    if (!dep.source) continue;
    // The SAME checks the publish door runs (refs, SQL dry run, chart bindings
    // against query columns) — so "which dependents broke" is answered by the
    // rule that admitted them.
    const checked = await checkDocumentData(dep.source, load);
    if (!checked.ok) warnings.push({ id: dep.id, title: dep.title, details: checked.details });
  }
  return warnings;
}

/**
 * The document's dataflow at render (or on a re-query): the `<Value>`/`<Query>`
 * declarations of `row.source`, run over the datasets its SQL names — each
 * resolved by the SAME ownership rule as refDataForRow (the doc's token, then
 * the owning account), so a query can read exactly what a `ref:` could and
 * nothing else. Returns null for a document that declares nothing.
 *
 * `values` overrides the declared defaults (a reader's current selections);
 * `only` restricts the run to those queries (the re-query path).
 */
export async function dataflowForRow(
  row: ArtifactRow,
  opts: DataflowRunOptions = {},
): Promise<RanDataflow | null> {
  if (!row.source) return null;
  const declared = await declarationsForRow(row);
  // A document that cannot run arrives already answered (unrunnableDataflow).
  if (declared?.state) return { ...declared, state: declared.state };
  // `viewer` absent is ANONYMOUS, deliberately — that is what the document's own
  // GET transport is, and it is the safe default for every caller that has no
  // session to hand over.
  const flow = declared?.flow;
  const members = await acceptedMembers(row.id);
  const resolver = sharedImports(datasetResolverForRow(row, opts.viewer ?? null), opts.importCache);
  const result = flow ? await runDeclaredDataflow(flow, resolver, {...opts,members}) : null;
  // A document NAMES people when a user-typed value or column reaches it, and
  // now also when it draws a <User> — which a document with no user data at all
  // may do (`<User userId="$_me.id" />`). The viewer's own id is added for both,
  // because the one person a page can always name is the one reading it. A
  // column is a person's when the compiler typed it `user` (a projection of a
  // user column, renamed, joined or grouped, keeps that type).
  if(result&&(drawsPeople(row.source)||result.flow.values.some(v=>v.kind==='scalar'&&v.type==='user')||Object.values(result.state.tables).some(t=>t.columns.some(c=>c.type==='user')))) {
    const db=await getDb(), options:NonNullable<DataflowState['userOptions']>={}, ids=new Set<string>();
    const viewer=opts.viewer??null;
    if(viewer?.userId)ids.add(viewer.userId);
    const permitted=async(column:DatasetColumn)=>{
      const refs=column.constraints?.memberOf;
      if(!refs)return column;
      const allowed:string[]=[];
      for(const ref of refs) {
        const id=ref==='current'?row.id:ref.slice(4), scope=await getArtifactById(id);
        if(scope&&(scope.token_id===viewer?.tokenId||await canReadArtifact(scope,viewer?.userId?{userId:viewer.userId,email:viewer.email??null}:null)))allowed.push(`ref:${id}`);
      }
      return {...column,constraints:{...column.constraints,memberOf:allowed}};
    };
    for(const [name,table] of Object.entries(result.state.tables))for(const column of table.columns) {
      if(column.type!=='user')continue;
      options[`${name}.${column.name}`]=await userOptions(db,await permitted(column),viewer?.userId??null);
      for(const item of table.rows)if(typeof item[column.name]==='string')ids.add(item[column.name] as string);
    }
    for(const value of result.flow.values)if(value.kind==='scalar'&&value.type==='user') {
      options[value.name]=await userOptions(db,await permitted({name:value.name,type:'user',constraints:value.constraints}),viewer?.userId??null);
      if(typeof result.state.values[value.name]==='string')ids.add(result.state.values[value.name] as string);
    }
    result.state.userOptions=options;
    result.state.people=await people(db,[...ids]);
  }
  if (result?.flow.mutations.length) result.state.mutationAccess = await mutationAccessFor(row, result.flow, result.state, opts.viewer ?? null);
  return result;
}

/** A resolver whose import reads go through `cache` (one caller's repeated runs); authority checks never do. */
function sharedImports(resolve: DatasetResolver, cache: ImportCache | undefined): DatasetResolver {
  if (!cache) return resolve;
  return (id, mode) => {
    if (mode !== undefined && mode !== 'import') return resolve(id, mode);
    let held = cache.get(id);
    if (!held) { held = resolve(id, mode); cache.set(id, held); }
    return held;
  };
}

/**
 * The document's queries once per entry of `runs` (each its own values and `only`), as `viewer` —
 * dataflowForRow's run, resolver and access rule, but ONE engine call over imports loaded once:
 * the offline file's precomputed filters. Only the tables and errors of each run, in `runs` order
 * (no people, options or mutation access: a variant carries none of them). Empty for a document
 * that declares nothing; a document that cannot run answers its one fixed state for every run.
 */
export async function dataflowRunsForRow(
  row: ArtifactRow,
  opts: Pick<DataflowRunOptions, 'viewer' | 'tz' | 'importCache'>,
  runs: ReadonlyArray<{ values?: Record<string, Scalar>; only?: Iterable<string> }>,
): Promise<Array<Pick<DataflowState, 'tables' | 'errors'>>> {
  if (!row.source || !runs.length) return runs.map(() => ({ tables: {}, errors: {} }));
  const declared = await declarationsForRow(row);
  if (declared?.state) return runs.map(() => ({ tables: declared.state!.tables, errors: declared.state!.errors }));
  if (!declared?.flow) return runs.map(() => ({ tables: {}, errors: {} }));
  const members = await acceptedMembers(row.id);
  const resolver = sharedImports(datasetResolverForRow(row, opts.viewer ?? null), opts.importCache);
  const { state } = await executeDocumentQueriesMany(declared.flow, resolver, { members, userId: opts.viewer?.userId ?? null, tz: readerZone(opts.tz) }, runs);
  return state.map(({ tables, errors }) => ({ tables, errors }));
}

/** Viewer capabilities use the same dataset ACL as execution; no authored permission expressions.
 * The preview analyzes the statement under the DECLARED argument types too, so the button the page
 * draws and the write the click attempts are judged on one plan.
 *
 * A statement reading the viewer additionally needs a PERSON, and a guest
 * pressing it would otherwise learn that from the raw refusal ("$_me.id
 * requires a logged-in user") after the click. That answer is decided last, on
 * a capability that is otherwise PERMITTED — "unavailable only because the
 * viewer is a guest" — so a dataset that refuses this actor for its own
 * reasons keeps saying so, and only the reader who could proceed by signing in
 * is asked to.
 */
async function mutationAccessFor(doc: ArtifactRow, flow: CompiledDataflow, state: DataflowState, viewer: RoleActor | null): Promise<Record<string,string|null>> {
  // ONE capability question for the whole document, asked once: may this
  // reader write as themselves here at all? A guest is answered exactly as an
  // anonymous reader is — with the code the page turns into `<SignIn>` — so the
  // button a guest sees is the door rather than a control that will refuse.
  const me: CapabilityActor = { userId: viewer?.userId ?? null, tokenId: viewer?.tokenId ?? null };
  const meRefusal = await can(me, 'write_as_me', doc) ? null : (await refusalFor(me, doc.id)).body.hint ?? SIGN_IN_REQUIRED;
  const guestOf = (m: CompiledMutation, answer: string|null): string|null =>
    answer === null && readsViewer(m) && meRefusal ? meRefusal : answer;
  return Object.fromEntries(await Promise.all(flow.mutations.map(async m=>{
    if(readsViewer(m) && meRefusal)return [m.name,meRefusal];
    const ref=mutationTargetRef(flow,m);
    if(!ref)return [m.name,guestOf(m,null)];
    const actor=viewer??{userId:null,tokenId:null};
    const candidate=await getArtifactById(ref);
    const dataset=candidate&&grantsOf(candidate)?candidate:await getArtifactFor(writerFor(doc),ref);
    if(dataset&&grantsOf(dataset)){
      try{await grantContext(dataset,actor,{id:doc.id,editId:doc.edit_id});}
      catch(error){return [m.name,!actor.userId?SIGN_IN_REQUIRED:error instanceof Error?error.message:'Join this artifact to use its actions'];}
    }
    if(!dataset||await canWriteDataset(dataset,actor,{id:doc.id,editId:doc.edit_id}))return [m.name,'You don’t have permission to edit this data.'];
    if(!dataset.dataset_policy)return [m.name,guestOf(m,null)];
    try {
      const target=m.target as {import:string;table:string};
      const catalog=catalogOf(dataset);
      const table=catalog?importedTables(catalog).find(t=>t.name===target.table):undefined;
      if(!table)return [m.name,'This action writes a table the dataset no longer has.'];
      const policy=await mutationPolicy(dataset,actor,table,{id:doc.id,editId:doc.edit_id});
      const names=mutationParams(m);
      const out=await runMutation({table:{schema:target.import,name:table.name,rows:[],columns:table.columns},sql:m.sql,params:bindParams(names,state.values),
        paramTypes:bindTypes(names,Object.fromEntries(m.args.map(a=>[a.name,a.type]))),reads:mutationReads(flow,m,{userId:actor.userId??null}),policy,policyPreview:true});
      return [m.name,guestOf(m,'error' in out?out.error:null)];
    }catch(error){return [m.name,error instanceof Error?error.message:'Dataset policy does not permit this action.'];}
  })));
}

/**
 * The document's compiled declarations, WITHOUT running anything — the reader's path.
 *
 * Same answer as dataflowForRow minus the expensive half: no dataset is
 * loaded, no SQL is executed, nothing is inlined. The document is served at
 * once and fetches its own rows through the transport its island already
 * names. On a production dashboard this was the difference between a ~100ms
 * render and an ~8ms one, and 231 KB of a 365 KB page.
 */
/**
 * A DOCUMENT THAT CANNOT RUN, as state that has already run: its Values at
 * their defaults and every query answering why — so nothing runs, the reader
 * never fetches, and no query is ever silent. Declarations come from the
 * Helmet; only the Values are compiled. The cause: a document whose data half
 * does not compile (what it imports changed shape since publish, or its store
 * is unreachable): each query answers with its own compile errors, or the
 * document's when it has none — by declaration name, as publish would have
 * refused it.
 */
async function unrunnableDataflow(row: Pick<ArtifactRow, 'source' | 'token_id' | 'user_id'>, answer: (query: QueryDecl) => string): Promise<RanDataflow | null> {
  const declared = declarationsOf(row.source ?? '');
  if (!declared || isEmptyDataflow(declared)) return null;
  const compiled = await compileWithLoader({ ...EMPTY_DATAFLOW, values: declared.values }, schemaLoaderFor(refLoaderForActor(writerFor(row))), { extensions: sqlExtensions() });
  const flow = compiled.ok ? compiled.compiled : EMPTY_COMPILED_DATAFLOW;
  return { flow, state: { values: initialValues(flow), tables: initialTables(flow), errors: Object.fromEntries(declared.queries.map((q) => [q.name, answer(q)])) } };
}

/** A declaration's own compile errors (by source span), else the document's. */
const errorsOf = (errors: ValidationError[]) => (declaration: { start: number; end: number }): string => {
  const own = errors.filter((e) => e.start !== undefined && e.start >= declaration.start && (e.end ?? e.start) <= declaration.end);
  return compileErrorText(own.length ? own : errors);
};

export async function declarationsForRow(row: CompilableRow): Promise<StoryIslandDataflow | null> {
  let result: CompileResult | null;
  // Loading what the document imports can fail too (the store is unreachable): that is said, not swallowed.
  try { result = await compileResultForRow(row); }
  catch (error) { return unrunnableDataflow(row, () => `The document's data could not be compiled: ${error instanceof Error ? error.message : String(error)}`); }
  if (!result) return null;
  if (!result.ok) return unrunnableDataflow(row, errorsOf(result.errors));
  return isEmptyCompiled(result.compiled) ? null : { flow: result.compiled };
}

/**
 * A document DRAWS A PERSON — a conservative hint, not a parse.
 *
 * `<User …>`, `<UserImage …>` and `<UserHandle …>` are the only spellings the
 * markup validator admits for the three person components, so a document that
 * draws one always matches; a match inside a string or a comment costs exactly
 * one indexed lookup and nothing else. It is deliberately a hint rather than a
 * parse because the answer is only used to decide whether to SPEND a query,
 * never to decide what a viewer may see.
 */
const drawsPeople = (source: string | null | undefined): boolean => /<User(?:Image|Handle)?[\s/>]/.test(source ?? '');
/**
 * WHO IS READING, as the document may show them (lib/story-runtime/contract
 * StoryViewer): the viewer's own account id — `$_me` — and, only for a document
 * that draws a person, their card.
 *
 * The card comes from the SAME `people` lookup a DataTable cell has always
 * used, so nothing new about anyone is exposed: one row, by id, for the person
 * who is already logged in and asking. A guest gets null and no query at all,
 * and a document that never names a person pays nothing beyond the id it
 * already had in hand.
 */
export async function viewerIdentityFor(
  row: Pick<ArtifactRow, 'source'>,
  userId: string | null | undefined,
): Promise<StoryViewer | null> {
  if (!userId) return null;
  if (!drawsPeople(row.source)) return { id: userId };
  try {
    const cards = await people(await getDb(), [userId]);
    return { id: userId, card: cards[userId] ?? null };
  } catch { return { id: userId }; }
}

interface DataflowRunOptions {
  members?:Row[];
  /**
   * One caller's repeated runs (the offline file's precomputed filters) sharing the imports' rows: each
   * import is read and parsed once per map, not once per run. The authority recheck ('verify') is never shared.
   */
  importCache?: ImportCache;
  /** Request-owned admission, rerun before cache hits, after waits and SQL. */
  authorize?: () => Promise<void>;
  signal?: AbortSignal;
  localTables?: Record<string, Row[]>;
  /**
   * WHO IS READING. Only a folder's children table varies with it today, and
   * that is exactly the point: reach is the document owner's, the rows are the
   * viewer's. Absent = anonymous.
   */
  viewer?: RoleActor | null;
  /** The reader's zone (`$_tz`); UTC when absent. */
  tz?: string;
  values?: Record<string, Scalar>;
  only?: Iterable<string>;
  /** A window of one query (a table reading past the cap). */
  page?: { name: string; offset: number; limit: number; sort?: { col: string; dir: 'asc' | 'desc' } };
}

/**
 * Resolve an imported (or queried) artifact to what the dataflow reads, or null.
 *
 * It answers TABLES rather than a row because there are two kinds of import
 * and they are reached differently: a DATASET's rows come out of the object
 * store, and a FOLDER's children are computed per VIEWER. Keeping the viewer
 * in the resolver's closure is what stops the two questions collapsing —
 * REACH (may this document read that id at all) is the document owner's,
 * while WHICH ROWS is the person reading it, and answering both with one
 * identity would hand a stranger the owner's private children. A connected
 * database resolves to its catalog, which its queries run inside.
 */
type DatasetResolver = (id: string, mode?: DocumentQuerySourceMode) => Promise<RefData | null>;
export type ImportCache = Map<string, Promise<RefData | null>>;

/** What a resolved ref contributes to the run: its tables by import name, or the catalog a query runs inside. */
type RefData = { tables: ImportTables[string]; catalog?: import('@/lib/datasets/types').DatasetCatalog };

/** A resolved ref row → its data, under the viewer whose run this is. */
export async function tableForRef(r: ArtifactRow | null, viewer: RoleActor | null, document?:ArtifactRow, loadRows=true): Promise<RefData | null> {
  if (!r) return null;
  if (r.format === 'folder') {
    if (!loadRows) return {tables:{}};
    return { tables: { rows: await childrenTableFor(r, { userId: viewer?.userId ?? null, email: viewer?.email ?? null, tokenId: viewer?.tokenId ?? null }) } };
  }
  if (r.format !== 'dataset') return null; // wrong kind → the query reports the missing table
  if(grantsOf(r)&&!(await grantsPermitRead(r,viewer??{userId:null,tokenId:null},document)))return null;
  const catalog=catalogOf(r);
  if(!catalog)return null; // missing storage is unavailable data, never an empty computed source
  if(!loadRows||catalog.kind==='postgres')return { tables: {}, catalog };
  try {
    return { tables: await importedRows(catalog), catalog };
  } catch { return null; } // the query reports the missing table
}

/** A document's own scope: the token that published it, its owning account, then
 * anything link-readable — render-time must resolve whatever the publish door
 * admitted (getLinkReadableArtifact), or an accepted ref serves broken. The
 * VIEWER is separate and rides through: reach is the document's, rows are theirs. */
const datasetResolverForRow = (row: ArtifactRow, viewer: RoleActor | null): DatasetResolver => async (id,mode) =>
  tableForRef(await importedArtifactFor(row, id), viewer, row, mode===undefined||mode==='import');

/** The artifact a document's import names, by the document's own reach. */
const importedArtifactFor = async (row: ArtifactRow, id: string): Promise<ArtifactRow | null> =>
  getArtifactById(id).then(async dataset=>dataset&&grantsOf(dataset)?dataset:(await getArtifactFor(writerFor(row),id))??(await getLinkReadableArtifact(id)));

/**
 * WHAT A READER MAY HOLD: every row of one import, for a page that runs the
 * queries over it itself (lib/dataflow/placement) — or null.
 *
 * Two readers are asked about, and both must agree. The DOCUMENT must read the
 * import (the same resolver its runs use), and the VIEWER must be allowed the
 * dataset's own rows: a public document's results over a private dataset are
 * public, its rows are not. Only a stored dataset qualifies — a connected
 * database runs inside itself, a folder listing is computed per viewer — and
 * only under the hold cap, past which its queries stay on the server. Reads
 * carry no row-level rules today (a read grant is the whole dataset), so the
 * dataset's rows are exactly what the viewer may read.
 */
async function holdableDataset(row: ArtifactRow, ref: string, viewer: RoleActor | null): Promise<import('@/lib/datasets/types').DatasetCatalog | null> {
  const dataset = await importedArtifactFor(row, ref);
  if (!dataset || dataset.format !== 'dataset') return null;
  const reader: RoleActor = viewer ?? { userId: null, tokenId: null };
  if (!ownsArtifact(dataset, reader) && !(await canReadArtifact(dataset, reader.userId ? { userId: reader.userId, email: reader.email ?? null } : null))) return null;
  // The document-scoped read grant a run applies (tableForRef), for this reader.
  if (grantsOf(dataset) && !(await grantsPermitRead(dataset, reader, row))) return null;
  const catalog = catalogOf(dataset);
  if (catalog?.kind !== 'stored') return null;
  let rows = 0, bytes = 0;
  for (const table of importedTables(catalog)) {
    if (!table.objectKey) continue;
    const stats = await storedRowStats(table.objectKey, HOLD_MAX_BYTES);
    rows += stats.rows; bytes += stats.bytes;
    if (rows > HOLD_MAX_ROWS || bytes > HOLD_MAX_BYTES) return null;
  }
  return catalog;
}

/**
 * WHAT THE DOCUMENT'S DATA IS, as one string that changes when it does: each imported dataset's
 * catalog (stored tables are content-addressed objects), version and access revisions. Null when
 * any import is not a stored dataset (a connected database can change under a constant key), so a
 * caller that caches results by this key never caches those.
 */
export async function importsFingerprint(row: ArtifactRow, flow: CompiledDataflow): Promise<string | null> {
  const refs = [...new Set(flow.imports.map((i) => i.ref))].sort();
  if (flow.queries.some((q) => q.source)) return null;
  const parts: unknown[] = [];
  for (const ref of refs) {
    const dataset = await importedArtifactFor(row, ref);
    const catalog = dataset && dataset.format === 'dataset' ? catalogOf(dataset) : null;
    if (!dataset || catalog?.kind !== 'stored') return null;
    parts.push([ref, dataset.version, dataset.policy_revision ?? 0, dataset.sharing_revision ?? 0, catalog]);
  }
  return JSON.stringify(parts);
}

async function heldImportFor(row: ArtifactRow, flow: CompiledDataflow, name: string, viewer: RoleActor | null): Promise<ImportTables[string] | null> {
  const ref = importRef(flow, name);
  const catalog = ref ? await holdableDataset(row, ref, viewer) : null;
  return catalog ? importedRows(catalog) : null;
}

/**
 * The imports this reader may hold, by name, in declaration order — the
 * island's `dataflow.hold`. Asked on every page render, so it never reads a
 * dataset's rows: sizes come from storedRowStats, and a dataset imported
 * under several names is decided once.
 */
export async function holdableImports(row: ArtifactRow, flow: CompiledDataflow, viewer: RoleActor | null): Promise<string[]> {
  const byRef = new Map<string, Promise<unknown>>();
  const held = await Promise.all(flow.imports.map(async (i) => {
    if (!byRef.has(i.ref)) byRef.set(i.ref, holdableDataset(row, i.ref, viewer));
    return (await byRef.get(i.ref)) ? i.name : null;
  }));
  return held.filter((name): name is string => name !== null);
}

/** One import's rows for this reader, or null when they may not hold it (the query route's `hold`). */
export async function holdImport(row: ArtifactRow, name: string, viewer: RoleActor | null): Promise<ImportTables[string] | null> {
  const flow = (await declarationsForRow(row))?.flow;
  return flow ? heldImportFor(row, flow, name, viewer) : null;
}

/**
 * THE PEOPLE A READER'S PAGE MAY NAME, for results it computed itself (the
 * query route's `people`): a query the server never ran sent no cards.
 *
 * Only whom the server-side run could have named for this viewer: the viewer
 * themselves, and the people in a user column of an import this viewer may
 * hold whole, when one of the document's queries shows a person from it — the
 * rows that page computes from. The ids asked for only narrow that set; anyone
 * outside it is absent, as an id nobody has is (lib/datasets/user-fields people).
 * Without `ids`, everyone in that set: the offline file, which can ask nobody
 * later, carries them all (lib/offline/assemble.server).
 */
export async function nameablePeople(row: ArtifactRow, viewer: RoleActor | null, ids?: string[]): Promise<Record<string, PersonCard>> {
  const wanted = ids ? new Set(ids) : null, allowed = new Set<string>();
  if (viewer?.userId && (!wanted || wanted.has(viewer.userId))) allowed.add(viewer.userId);
  const flow = row.format === 'markup' ? (await declarationsForRow(row))?.flow : undefined;
  if (flow) {
    const shown = new Set(flow.queries.filter((q) => q.columns.some((c) => c.type === 'user')).flatMap((q) => selectQueries(flow, { only: [q.name] }).flatMap((u) => u.reads.imports)));
    const refs = new Set<string>();
    for (const i of flow.imports) {
      if (!shown.has(i.name) || refs.has(i.ref) || !i.tables.some((t) => t.columns.some((c) => c.type === 'user'))) continue;
      refs.add(i.ref);
      for (const table of Object.values((await heldImportFor(row, flow, i.name, viewer)) ?? {})) {
        for (const column of table.columns) if (column.type === 'user') for (const r of table.rows) {
          const id = r[column.name];
          if (typeof id === 'string' && (!wanted || wanted.has(id))) allowed.add(id);
        }
      }
    }
  }
  return allowed.size ? people(await getDb(), [...allowed]) : {};
}

/** A bearer/session actor's scope — the editor running a DRAFT's queries. Reach and viewer are the same person here. */
export const datasetResolverForActor = (actor: TokenActor): DatasetResolver => async (id,mode) =>
  tableForRef((await getArtifactFor(actor, id)) ?? (await getLinkReadableArtifact(id)), { userId: actor.userId, tokenId: actor.tokenId },undefined,mode===undefined||mode==='import');

/** The rows of the named imports, resolved; an import that does not resolve is left out, and its readers report the missing table. */
async function importsFor(flow: CompiledDataflow, names: Iterable<string>, resolve: DatasetResolver): Promise<ImportTables> {
  const out: ImportTables = {};
  for (const name of new Set(names)) {
    const ref = importRef(flow, name);
    const data = ref ? await resolve(ref) : null;
    if (data) out[name] = data.tables;
  }
  return out;
}

export const isEmptyCompiled = (flow: CompiledDataflow): boolean =>
  !flow.imports.length && !flow.values.length && !flow.queries.length && !flow.mutations.length;

/**
 * Compile and run the declarations of any markup SOURCE (a draft) over what
 * `resolve` admits, compiled under `load` (the same caller's reach). Null when
 * it declares nothing or does not compile.
 */
export async function runDocumentDataflow(
  source: string,
  load: ServerRefLoader,
  resolve: DatasetResolver,
  opts: DataflowRunOptions = {},
): Promise<RanDataflow | null> {
  const declared = declarationsOf(source);
  if (!declared || isEmptyDataflow(declared)) return null;
  const compiled = await compileWithLoader(declared, schemaLoaderFor(load), { extensions: sqlExtensions() });
  // A draft that does not compile runs nothing, and says why under each declaration's own name.
  if (!compiled.ok) return { flow: EMPTY_COMPILED_DATAFLOW, state: { values: {}, tables: {}, errors: compileErrorsByName(compiled.errors) } };
  return runDeclaredDataflow(compiled.compiled, resolve, opts);
}

/** Compile errors keyed by the declaration they name (`<Query name="q">…` → q); the rest under the empty name. */
function compileErrorsByName(errors: ReadonlyArray<{ message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of errors) {
    // Compile messages name their declaration either way: `<Query name="x">` or `<Query> "x"`.
    const named = /^<(?:Query|Mutation|Import|Value)(?: name="([^"]+)"|> "([^"]+)")/.exec(e.message);
    const name = named?.[1] ?? named?.[2] ?? '';
    out[name] = out[name] ? `${out[name]}\n${e.message}` : e.message;
  }
  return out;
}

async function runDeclaredDataflow(flow: CompiledDataflow, resolve: DatasetResolver, opts: DataflowRunOptions): Promise<RanDataflow> {
  const { state } = await executeDocumentQueries(flow, resolve, { ...opts, userId: opts.viewer?.userId ?? null, tz: readerZone(opts.tz) });
  return { flow, state };
}

/**
 * The artifact ids a document's DATA depends on — what it imports, the
 * databases its queries run inside, and the datasets its user pickers draw
 * from. What the live stream subscribes to, so a write anywhere in that set
 * wakes this document's readers (app/a/[id]/events). Validated against the
 * current source on every read, because an edit can change what a document
 * reads. Mutation targets are imports, so they are included.
 */
export async function datasetsForDocument(document: (Pick<ArtifactRow, 'id' | 'version' | 'source' | 'meta' | 'token_id' | 'user_id'>) | null | undefined): Promise<string[]> {
  if (!document?.source) return [];
  try {
    const flow = await compiledForRow(document);
    return flow ? dataRefs(flow, flow.values.flatMap((v) => (v.source ? [v.source] : []))) : [];
  } catch { return []; }
}


/** Resolve an admitted asset using the document owner's normal reference scope. */
export async function referencedArtifactForRow(row: ArtifactRow, id: string): Promise<ArtifactRow | null> {
  const refs = (row.meta as { refs?: Array<{ id: string }> }).refs ?? [];
  if (!refs.some((ref) => ref.id === id)) return null;
  return (await getArtifact(row.token_id, id))
    ?? (row.user_id ? await getArtifactByUser(row.user_id, id) : null)
    ?? (await getLinkReadableArtifact(id));
}

/** Build the render-time RefDataMap for a jsx artifact: recipes → parsed
 * template, images → their /a URL. (Datasets: see dataflowForRow.) */
export async function refDataForRow(
  row: ArtifactRow,
  opts: { capture?: boolean } = {},
): Promise<import('@/lib/dataflow/ref-data').RefDataMap> {
  const meta = row.meta as { refs?: Array<{ id: string; kind: string }> };
  const out: import('@/lib/dataflow/ref-data').RefDataMap = {};
  // A dataset a <Query> reads is a ref (ownership, dependents) but NOT page
  // data: its rows go through the engine (dataflowForRow) and only the query's
  // RESULT reaches the document.
  for (const ref of meta.refs ?? []) {
    if (ref.kind === 'dataset' || ref.kind === 'document') continue;
    // Resolve by the doc's token first, then — for a user-owned doc — by the
    // account, then anything link-readable. A signed-in human's docs and their
    // pasted images can sit under DIFFERENT tokens of the same user (the doc on
    // a claimed agent token, the image on the account's 'web' token), and the
    // widened publish door admits any public/unlisted asset besides — whatever
    // it admitted, this must resolve, or the accepted image renders broken.
    const r = await referencedArtifactForRow(row, ref.id);
    if (!r) continue; // deleted ref → the embed degrades to its fallback
    if (r.format === 'viz') {
      try { out[r.id] = { kind: 'viz', recipe: JSON.parse(r.source ?? '') }; } catch { /* skip */ }
    } else if (r.format === 'image') {
      out[r.id] = imageRefData(r,opts.capture);
    } else if (r.format === 'file') {
      out[r.id]={kind:'file',url:imageRawUrl(r.id,r.version)};
    } else if (r.format === 'pdf') {
      // What the CARD says: where the file is, what it is called, how big it is
      // and how long. The name is the artifact's title (the author's, or the
      // one the importer derived from the URL), never the object key.
      const pm = r.meta as { bytes?: unknown; pages?: unknown } | null;
      out[r.id] = {
        kind: 'pdf',
        url: pdfRawUrl(r.id, r.version),
        name: displayTitle(r),
        bytes: typeof pm?.bytes === 'number' ? pm.bytes : 0,
        ...(typeof pm?.pages === 'number' ? { pages: pm.pages } : {}),
      };
    }
  }
  return out;
}

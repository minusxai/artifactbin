import {artifactQuery} from '@/lib/artifact-document';
import { grantsOf, assertGrantCommit } from '@/lib/datasets/policy/grants';
import {validateUserWrites} from '@/lib/datasets/user-fields';
import {DatasetError} from '@/lib/datasets/errors';
import {artifactState} from '@/lib/artifact-state';
import {completeMutationReceipt,type MutationReceipt} from '@/lib/mutation-receipt';
import {throttlePublicMutation} from '@/lib/datasets/policy/usage';
import {mutationPolicy,recheckMutation,canUseDataPolicy,policyReaderSql,type MutationDocument} from '@/lib/datasets/policy';
import {catalogOf,importedTables} from '@/lib/datasets/catalog';
import {SIGN_IN_REQUIRED} from './sign-in-required';
import {loadSqlite} from '@artifactbin/sql/core';
import {sqlExtensions} from '@/lib/sql/extensions';
import {paramSqlName} from '@artifactbin/contracts';
/**
 * WRITING a dataset — the other half of lib/story/dataset-store.
 *
 * A dataset's rows are ONE content-addressed blob per table and one row
 * pointing at them, so a write is: read the blob, run the author's DML over it
 * in a throwaway SQLite database (lib/sql/engine runMutation), store what the
 * table became, and swap the pointer. The interesting part is the swap.
 *
 * COMPARE-AND-SWAP, AND WHY THAT IS ENOUGH. The update is guarded on the
 * `edit_id` the rows were read at, so two writers cannot interleave a
 * read-modify-write. A loser does not merge and does not fail: it re-reads and
 * re-runs its own statement against the winner's rows. That is sound in a way
 * a text edit never was, and for a reason worth stating — a splice is
 * POSITIONAL, so replaying it on a changed base can land somewhere its author
 * never meant; DML is not. `insert … values (…)` replayed against the new rows
 * appends after the other writer's row; `update … where …` re-applied to the
 * current rows is exactly what its author asked for; `delete … where …`
 * likewise. So the rebase is free, no write is ever lost, and there is no lock
 * anywhere: writes to one dataset serialize on its own edit_id, writes to
 * different datasets never meet.
 *
 * Everything else is deliberately the paths that already exist: the blob is
 * content-addressed (an idempotent write costs no object), the previous state
 * is archived into `artifact_versions` on the same coalescing rule text edits
 * use (so `revert` works on data), and the row's own channel is NOTIFYed, so
 * every open document reading this dataset re-queries (lib/story/live).
 */
import { trackEvent } from '@/lib/analytics';
import { MAX_QUERY_ROWS } from '@/lib/config';
import { getDb } from '@/lib/db';
import { isQueryFailure, runMutation, type MutationInput } from '@/lib/sql/engine';
import { LIVE_ARTIFACT_SQL, canWriteDataset, editorScope, type ArtifactRow, type RoleActor } from '@/lib/artifacts';
import { loadDatasetRows, storeDatasetRows } from './dataset-store';
import type {Scalar} from './dataflow';
import { newEditId } from './splice';
import {mutationInvocation} from '@/lib/mutation-invocation';
import type {MutationOutcome,DatasetMutationPolicy,Queryable} from '@artifactbin/contracts';

/** How long after the last archived version a write reuses that snapshot (matches the edit protocol). */
const WRITE_SNAPSHOT_WINDOW_MS = 120_000;
/** A CAS miss is an ordinary outcome under concurrency; this bounds the retry, not the correctness. */
const WRITE_CAS_RETRIES = 8;

/** Test seam for the row cap, which is config-read-once (see setDatasetRowCapForTests in lib/artifacts). */
let rowCapOverride: number | null = null;
export function setDatasetRowCap(cap: number | null): void {
  rowCapOverride = cap;
}
const datasetRowCap = (): number => rowCapOverride ?? MAX_QUERY_ROWS;

interface MutationRefused {
  /**
   * `invalid_sql` = the statement itself; `dataset_full` = the row cap;
   * `contended` = too many concurrent writers to land inside the retry budget.
   * The last is deliberately its own reason: it is not an author error, and
   * reporting it as one tells a caller to fix SQL that is perfectly good when
   * the honest answer is "try again". (Unreachable on PGLite, which serializes
   * every operation; reachable on Postgres.)
   */
  reason: 'policy_denied' | 'invalid_sql' | 'dataset_full' | 'contended' | 'row_changed' | 'row_not_unique' | 'dataset_read_only';
  detail: string;
  /**
   * A MACHINE-READABLE reason beside the sentence, for the one refusal a
   * reader can act on: `sign_in_required` (lib/story/sign-in-required). The
   * status and `reason` are unchanged by it — it only lets the page draw a
   * door where it would otherwise print a parameter binding.
   */
  code?: typeof SIGN_IN_REQUIRED;
}

interface MutationApplied {
  row: ArtifactRow;
  /** Rows the statement changed (the engine's own count). */
  affected: number;
  /** Rows the dataset holds afterwards. */
  rowCount: number;
}

export const isMutationRefused = (r: MutationApplied | MutationRefused): r is MutationRefused => 'reason' in r;

/**
 * Apply one DML statement as its actual actor. Recheck dataset edit access
 * on every retry and in the final UPDATE itself, so revoking a share while
 * SQL is executing prevents that write from landing.
 *
 * `guard.target` names the table as the statement names it — a document's
 * `<Import>` schema and the table (`bookings.rows`), which the compiler
 * established; absent (the owner's direct write door), SQLite's own analysis
 * of the statement over the dataset's stored tables, under their catalog
 * schemas, says which one it writes. `params` are bound by SQL name and never
 * interpolated, under the declared types the caller passes — the typing the
 * publish-time analysis used, so the two cannot plan the statement differently.
 */
export async function mutateDataset(
  dataset: ArtifactRow,
  actor: RoleActor,
  sql: string,
  params: Record<string, Scalar> = {},
  guard: Pick<MutationInput, 'expectedAffected' | 'paramTypes' | 'reads'> & {target?:{schema:string;table:string};document?:MutationDocument;receipt?:MutationReceipt;expectedState?:string} = {},
): Promise<MutationApplied | MutationRefused> {
  if(Object.hasOwn(params,paramSqlName('_me.id'))&&!actor.userId)return {reason:'policy_denied',detail:'$_me.id requires a logged-in user',code:SIGN_IN_REQUIRED};
  const db = await getDb();
  const scope = editorScope({userId:actor.userId,tokenId:actor.tokenId ?? ''});
  const invocation=mutationInvocation({dataset,actor,document:guard.document,db,recheckAccess:async()=>{await recheckMutation(dataset,actor,guard.document);}});
  if(guard.document && await canUseDataPolicy(dataset,actor) && await canWriteDataset(dataset,actor)){
    try{await throttlePublicMutation(dataset.id);}catch(error){return {reason:'dataset_read_only',detail:error instanceof Error?error.message:'Public mutation limit reached'};}
  }

  for (let attempt = 0; ; attempt++) {
    // Re-read on every attempt: attempt 0 uses the row we were handed, and a
    // CAS miss means someone else's rows are now the base for ours.
    const current = attempt === 0
      ? dataset
      : (await artifactQuery<ArtifactRow>(db,`SELECT * FROM artifacts WHERE id = $1 AND ${LIVE_ARTIFACT_SQL}`, [dataset.id])).rows[0];
    // Deleted under us — the write has nothing to apply to. Reported as a
    // refusal rather than thrown: the caller answers the uniform 404 anyway.
    if (!current) return { reason: 'invalid_sql', detail: 'the dataset no longer exists' };
    if(guard.expectedState&&artifactState(current)!==guard.expectedState)return {reason:'row_changed',detail:'The dataset changed since the operation was prepared. Read the current state before proposing a new mutation.'};
    if ((current.policy_revision??0)!==(dataset.policy_revision??0) || await canWriteDataset(current, actor,guard.document??false)) return {reason:'dataset_read_only',detail:'You no longer have edit access to a writable dataset.'};

    if(guard.document){try{await recheckMutation(current,actor,guard.document);}catch(error){return {reason:'dataset_read_only',detail:error instanceof Error?error.message:'Mutation access changed'};}}
    const catalog=catalogOf(current);
    let selected:import('@/lib/datasets/types').DatasetTable;
    let schema:string;
    try{
      if(!catalog||catalog.kind!=='stored')throw new Error('only stored datasets are writable');
      const target=guard.target??await writtenTable(catalog,sql);
      const table=(guard.target?importedTables(catalog):catalog.tables.filter(t=>t.schema===target.schema)).find(t=>t.name===target.table);
      if(!table||table.sql!==undefined||!table.objectKey)throw new Error(`${target.schema}.${target.table} is not a stored table of this dataset`);
      selected=table;schema=target.schema;
    }catch(error){return {reason:'invalid_sql',detail:`Stored mutation: ${error instanceof Error?error.message:'invalid target'}`};}
    const columns = selected.columns;
    const rows = await loadDatasetRows({meta:{objectKey:selected.objectKey}});
    let out:MutationOutcome;
    let policy:DatasetMutationPolicy|undefined;
    try{
      policy=await mutationPolicy(current,actor,selected,guard.document??false);
      out = await invocation.run({ policy, table: { schema, name: selected.name, rows, columns }, sql, params,
        ...(guard.paramTypes?{paramTypes:guard.paramTypes}:{}), ...(guard.reads?.length?{reads:guard.reads}:{}), ...(guard.expectedAffected===undefined?{}:{expectedAffected:guard.expectedAffected}), limit: datasetRowCap() },{mutate:runMutation});
    }catch(error){return {reason:current.dataset_policy?'policy_denied':'invalid_sql',detail:error instanceof Error?error.message:'Dataset mutation failed'};}
    if (isQueryFailure(out)) {
      return { reason: out.code ?? (out.full ? 'dataset_full' : 'invalid_sql'), detail: out.error };
    }

    if(columns.some(c=>c.type==='user')&&!Array.isArray(out.userWrites))return {reason:'policy_denied',detail:'The SQL service must support user-field validation'};
    // Store BEFORE the swap: a blob nobody points at is garbage, a pointer to
    // a blob that is not there is a dataset that reads as empty.
    const located = await storeDatasetRows(out.rows);
    const meta = {
      ...(current.meta as Record<string, unknown>),
      // The engine reports the table's real shape back; a write may not change
      // it (the columns are the dataset's contract), but recording what came
      // back keeps the two from drifting if the engine widens a type.
      columns: out.columns.length ? out.columns : columns,
      rowCount: out.rows.length,
      objectKey: located.objectKey,
      ...(catalog?{catalog:{...catalog,tables:catalog.tables.map(t=>t===selected?{...t,objectKey:located.objectKey,columns:out.columns.length?out.columns:columns}:t)}}:{}),
      // A written dataset is no longer "the first N rows of a bigger source".
      totalRows: undefined,
      truncated: undefined,
    };
    if(selected.schema!=='public'||selected.name!=='rows'){
      const old=current.meta as typeof meta;
      meta.columns=old.columns;meta.objectKey=old.objectKey;meta.rowCount=old.rowCount;
    }
    delete meta.totalRows;
    delete meta.truncated;

    // ONE guarded statement: swap the pointer if and only if the rows we read
    // are still the rows on disk, archive the previous state (coalesced, like
    // the edit protocol), and wake every document reading this dataset.
    const v2=!!grantsOf(current);
    const commit=async(tx:Queryable)=>{
     if(v2)await assertGrantCommit(tx,current,actor,guard.document);
     await validateUserWrites(tx,columns,out.userWrites??[],actor.userId);
     if(guard.expectedState){
      const locked=(await artifactQuery<ArtifactRow>(tx,`SELECT * FROM artifacts WHERE id=$1 AND ${LIVE_ARTIFACT_SQL} FOR UPDATE`,[dataset.id])).rows[0];
      if(!locked||artifactState(locked)!==guard.expectedState)return {rows:[] as ArtifactRow[]};
     }
     const result=await artifactQuery<ArtifactRow>(tx,
      `WITH updated AS (
         UPDATE artifacts
            SET meta = $3::jsonb, version = version + 1, edit_id = $4, updated_at = now(), actor_user_id = $12, actor_token_id = $13
          WHERE id = $1 AND edit_id = $2 AND ($20::boolean OR access = 'readwrite') AND ${LIVE_ARTIFACT_SQL}
            AND policy_revision=$15 AND ($20::boolean OR (
              ($19::text IS NULL AND (${scope.where('$14')})) OR
              ($19='viewer' AND (${policyReaderSql('$12', '$13')}) AND ($18::boolean OR (${scope.where('$14')})))
            )
            ) AND ($20::boolean OR $16::text IS NULL OR EXISTS (
              SELECT 1 FROM artifacts d WHERE d.id=$16 AND d.edit_id=$17 AND d.deleted_at IS NULL
              AND (
                (d.user_id IS NULL AND artifacts.token_id=d.token_id) OR
                (d.user_id IS NOT NULL AND (artifacts.user_id=d.user_id OR
                  (artifacts.visibility<>'private' AND artifacts.link_role='editor') OR EXISTS (
                    SELECT 1 FROM artifact_shares writer_share WHERE writer_share.artifact_id=artifacts.id
                    AND writer_share.role='editor' AND (writer_share.user_id=d.user_id OR
                      (writer_share.user_id IS NULL AND writer_share.email=(SELECT email FROM users WHERE id=d.user_id)))
                  )))
              )
              AND (d.visibility <> 'private' OR d.user_id=$12 OR d.token_id=$13 OR EXISTS (
                SELECT 1 FROM artifact_shares s WHERE s.artifact_id=d.id AND
                (s.user_id=$12 OR (s.user_id IS NULL AND s.email=(SELECT email FROM users WHERE id=$12)))
              ))
            ))
          RETURNING *
       ), archived AS (
         INSERT INTO artifact_versions (artifact_id, version, title, description, format, source, meta)
         SELECT $1, $5, $6, $7, $8, $9, $10::jsonb
          WHERE EXISTS (SELECT 1 FROM updated)
            AND NOT EXISTS (
              SELECT 1 FROM artifact_versions
               WHERE artifact_id = $1 AND created_at > now() - ($11::int * interval '1 millisecond')
            )
         ON CONFLICT DO NOTHING
       )
       SELECT u.*, pg_notify('artifact_' || lower(u.id), u.edit_id) FROM updated u`,
      [
        dataset.id, current.edit_id, JSON.stringify(meta), newEditId(),
        current.version, current.title, current.description, current.format, current.source,
        JSON.stringify(current.meta), WRITE_SNAPSHOT_WINDOW_MS,
        actor.userId, actor.tokenId, scope.val, current.policy_revision??0,guard.document?.id??null,guard.document?.editId??null,!!guard.document&&!!policy,policy?.role??null,v2,
      ],
    );

     const committed=result.rows[0];
     if(committed&&guard.receipt)await completeMutationReceipt(tx,guard.receipt,{status:200,body:{id:committed.id,version:committed.version,affected:out.affected,rowCount:out.rows.length}});
     return result;
    };
    let updated;
    try { updated=v2||guard.receipt||guard.expectedState||columns.some(c=>c.type==='user')?await db.transaction(commit):await commit(db); }
    catch(error) { if(error instanceof DatasetError)return {reason:'policy_denied',detail:error.message}; throw error; }

    const row = updated.rows[0];
    if (row) {
      void trackEvent('mutate', row.id, { userId: row.user_id });
      return { row, affected: out.affected, rowCount: out.rows.length };
    }
    // Lost the CAS. Re-run against what landed — see the module doc: for DML
    // that is the same statement, not a merge.
    if (attempt >= WRITE_CAS_RETRIES) {
      return { reason: 'contended', detail: 'the dataset is being written too quickly to apply this change — try again' };
    }
  }
}

/** The one stored table a direct write names, by SQLite's own analysis of it over the dataset's catalog. */
async function writtenTable(catalog:import('@/lib/datasets/types').DatasetCatalog,sql:string):Promise<{schema:string;table:string}> {
  const relations=catalog.tables.filter(t=>t.objectKey&&t.sql===undefined).map(t=>({schema:t.schema,table:t.name,columns:t.columns}));
  const writes=(await loadSqlite()).analyze(sql,relations,{mode:'write',extensions:sqlExtensions()}).writes;
  const [write]=writes;
  if(!write||new Set(writes.map(w=>`${w.schema}\0${w.table}`)).size!==1)throw new Error('exactly one INSERT, UPDATE or DELETE of one catalog table is required');
  return {schema:write.schema,table:write.table};
}

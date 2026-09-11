import {generationAuthorization,throttlePublicMutation} from '@/lib/datasets/policy/usage';
import {mutationPolicy,recheckMutation,canUseDataPolicy,policyReaderSql,type MutationDocument} from '@/lib/datasets/policy';
import {catalogOf} from '@/lib/datasets/catalog';
import {compileStoredMutation} from '@/lib/datasets/stored-mutation';
/**
 * WRITING a dataset — the other half of lib/story/dataset-store.
 *
 * A dataset's rows are ONE content-addressed blob and one row pointing at it,
 * so a write is: read the blob, run the author's DML over it in a throwaway
 * DuckDB (lib/sql/engine runMutation), store what the table became, and swap
 * the pointer. The interesting part is the swap.
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
import type { DatasetColumn } from './dataset-shape';
import { loadDatasetRows, storeDatasetRows } from './dataset-store';
import type { Scalar } from './dataflow';
import { newEditId } from './splice';
import {createGenerationInvocation} from '@/lib/generation/executor';
import {services} from '@/lib/services';
import type {MutationOutcome,DatasetMutationPolicy} from '@artifactbin/contracts';

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

export interface MutationRefused {
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
}

export interface MutationApplied {
  row: ArtifactRow;
  /** Rows the statement changed (DuckDB's own count). */
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
 * `sql` names the dataset as `ref_<id>`, exactly as it is written in the
 * document; `params` are bound by name and never interpolated.
 */
export async function mutateDataset(
  dataset: ArtifactRow,
  actor: RoleActor,
  sql: string,
  params: Record<string, Scalar> = {},
  guard: Pick<MutationInput, 'row' | 'expectedAffected'> & {source?:boolean;document?:MutationDocument} = {},
): Promise<MutationApplied | MutationRefused> {
  const db = await getDb();
  const table = 'dataset_rows';
  const scope = editorScope({userId:actor.userId,tokenId:actor.tokenId ?? ''});
  // One result cache per invocation, outside the CAS loop: replaying storage
  // must not generate a different answer or charge for the same prompt again.
  const generation=createGenerationInvocation(services().generation,{beforeCall:generationAuthorization(dataset,actor,guard.document)});
  if(guard.document && await canUseDataPolicy(dataset,actor) && await canWriteDataset(dataset,actor)){
    try{await throttlePublicMutation(dataset.id);}catch(error){return {reason:'dataset_read_only',detail:error instanceof Error?error.message:'Public mutation limit reached'};}
  }

  for (let attempt = 0; ; attempt++) {
    // Re-read on every attempt: attempt 0 uses the row we were handed, and a
    // CAS miss means someone else's rows are now the base for ours.
    const current = attempt === 0
      ? dataset
      : (await db.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id = $1 AND ${LIVE_ARTIFACT_SQL}`, [dataset.id])).rows[0];
    // Deleted under us — the write has nothing to apply to. Reported as a
    // refusal rather than thrown: the caller answers the uniform 404 anyway.
    if (!current) return { reason: 'invalid_sql', detail: 'the dataset no longer exists' };
    if ((current.policy_revision??0)!==(dataset.policy_revision??0) || await canWriteDataset(current, actor,!!guard.document)) return {reason:'dataset_read_only',detail:'You no longer have edit access to a writable dataset.'};

    if(guard.document){try{await recheckMutation(current,actor,guard.document);}catch(error){return {reason:'dataset_read_only',detail:error instanceof Error?error.message:'Mutation access changed'};}}
    const catalog=catalogOf(current);
    let selected:import('@/lib/datasets/types').DatasetTable|undefined;
    let executedSql=sql;
    {
      try{if(!catalog)throw new Error('Dataset catalog unavailable');const compiled=compileStoredMutation(catalog,sql,table);selected=compiled.table;executedSql=compiled.sql;}
      catch(error){return {reason:'invalid_sql',detail:error instanceof Error?error.message:'Invalid stored mutation'};}
    }
    const columns = selected?.columns ?? ((current.meta as { columns?: DatasetColumn[] }).columns) ?? [];
    const rows = await loadDatasetRows(selected?{content:'',meta:{objectKey:selected.objectKey}}:current);
    const {source:_,document:__,...mutationGuard}=guard;
    let out:MutationOutcome;
    let policy:DatasetMutationPolicy|undefined;
    try{
      policy=await mutationPolicy(current,actor,selected??{schema:'public',name:'rows'},!!guard.document);
      out = await generation.run({ policy, table: { name: table, rows, columns }, sql:executedSql, params, ...mutationGuard, limit: datasetRowCap() },{mutate:runMutation});
    }catch(error){return {reason:current.dataset_policy?'policy_denied':'invalid_sql',detail:error instanceof Error?error.message:'Model generation failed'};}
    if (isQueryFailure(out)) {
      return { reason: out.code ?? (out.full ? 'dataset_full' : 'invalid_sql'), detail: out.error };
    }

    // Store BEFORE the swap: a blob nobody points at is garbage, a pointer to
    // a blob that is not there is a dataset that reads as empty.
    const located = await storeDatasetRows(out.rows);
    const meta = {
      ...(current.meta as Record<string, unknown>),
      // The engine reports the table's real shape back; a write may not change
      // it (the columns are the dataset's contract), but recording what came
      // back keeps the two from drifting if DuckDB widens a type.
      columns: out.columns.length ? out.columns : columns,
      rowCount: out.rows.length,
      objectKey: located.objectKey,
      ...(catalog?{catalog:{...catalog,tables:catalog.tables.map(t=>t===(selected??catalog.tables.find(t=>t.schema==='public'&&t.name==='rows'))?{...t,objectKey:located.objectKey,columns:out.columns.length?out.columns:columns}:t)}}:{}),
      // A written dataset is no longer "the first N rows of a bigger source".
      totalRows: undefined,
      truncated: undefined,
    };
    if(selected && (selected.schema!=='public'||selected.name!=='rows')){
      const old=current.meta as typeof meta;
      meta.columns=old.columns;meta.objectKey=old.objectKey;meta.rowCount=old.rowCount;
    }
    delete meta.totalRows;
    delete meta.truncated;

    // ONE guarded statement: swap the pointer if and only if the rows we read
    // are still the rows on disk, archive the previous state (coalesced, like
    // the edit protocol), and wake every document reading this dataset.
    const updated = await db.query<ArtifactRow>(
      `WITH updated AS (
         UPDATE artifacts
            SET content = '', meta = $3::jsonb, version = version + 1, edit_id = $4, updated_at = now(), actor_user_id = $13, actor_token_id = $14
          WHERE id = $1 AND edit_id = $2 AND access = 'readwrite' AND ${LIVE_ARTIFACT_SQL}
            AND policy_revision=$16 AND (
              ($20::text IS NULL AND (${scope.where('$15')})) OR
              ($20='viewer' AND (${policyReaderSql()}) AND ($19::boolean OR (${scope.where('$15')})))
            )
            AND ($17::text IS NULL OR EXISTS (
              SELECT 1 FROM artifacts d WHERE d.id=$17 AND d.edit_id=$18 AND d.deleted_at IS NULL
              AND (
                (d.user_id IS NULL AND artifacts.token_id=d.token_id) OR
                (d.user_id IS NOT NULL AND (artifacts.user_id=d.user_id OR
                  (artifacts.visibility<>'private' AND artifacts.link_role='editor') OR EXISTS (
                    SELECT 1 FROM artifact_shares writer_share WHERE writer_share.artifact_id=artifacts.id
                    AND writer_share.role='editor' AND (writer_share.user_id=d.user_id OR
                      (writer_share.user_id IS NULL AND writer_share.email=(SELECT email FROM users WHERE id=d.user_id)))
                  )))
              )
              AND (d.visibility <> 'private' OR d.user_id=$13 OR d.token_id=$14 OR EXISTS (
                SELECT 1 FROM artifact_shares s WHERE s.artifact_id=d.id AND
                (s.user_id=$13 OR (s.user_id IS NULL AND s.email=(SELECT email FROM users WHERE id=$13)))
              ))
            ))
          RETURNING *
       ), archived AS (
         INSERT INTO artifact_versions (artifact_id, version, title, description, format, content, source, meta)
         SELECT $1, $5, $6, $7, $8, $9, $10, $11::jsonb
          WHERE EXISTS (SELECT 1 FROM updated)
            AND NOT EXISTS (
              SELECT 1 FROM artifact_versions
               WHERE artifact_id = $1 AND created_at > now() - ($12::int * interval '1 millisecond')
            )
         ON CONFLICT DO NOTHING
       )
       SELECT u.*, pg_notify('artifact_' || lower(u.id), u.edit_id) FROM updated u`,
      [
        dataset.id, current.edit_id, JSON.stringify(meta), newEditId(),
        current.version, current.title, current.description, current.format, current.content, current.source,
        JSON.stringify(current.meta), WRITE_SNAPSHOT_WINDOW_MS,
        actor.userId, actor.tokenId, scope.val, current.policy_revision??0,guard.document?.id??null,guard.document?.editId??null,!!guard.document&&!!policy,policy?.role??null,
      ],
    );

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

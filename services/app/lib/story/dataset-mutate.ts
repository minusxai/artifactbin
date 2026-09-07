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
 * likewise. The computation stays outside transactions. A short, ordered
 * document/target lock at commit serializes permission changes; edit_id still
 * detects a changed data snapshot and drives the bounded rebase.
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
import { LIVE_ARTIFACT_SQL, canWriteDataset, editorScope, effectiveRole, type ArtifactRow, type RoleActor } from '@/lib/artifacts';
import { canRead } from '@/lib/share-roles';
import type { DatasetColumn } from './dataset-shape';
import { loadDatasetRows, storeDatasetRows } from './dataset-store';
import type { Scalar } from './dataflow';
import { newEditId } from './splice';

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
  reason: 'invalid_sql' | 'dataset_full' | 'contended' | 'row_changed' | 'row_not_unique' | 'dataset_read_only' | 'document_changed';
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
  guard: Pick<MutationInput, 'row' | 'expectedAffected'> & {source?:boolean; document?: {id: string; editId: string}} = {},
): Promise<MutationApplied | MutationRefused> {
  const db = await getDb();
  const table = `ref_${dataset.id}`;
  const scope = editorScope({userId:actor.userId,tokenId:actor.tokenId ?? ''});

  for (let attempt = 0; ; attempt++) {
    // Re-read on every attempt: attempt 0 uses the row we were handed, and a
    // CAS miss means someone else's rows are now the base for ours.
    const current = attempt === 0
      ? dataset
      : (await db.query<ArtifactRow>(`SELECT * FROM artifacts WHERE id = $1 AND ${LIVE_ARTIFACT_SQL}`, [dataset.id])).rows[0];
    // Deleted under us — the write has nothing to apply to. Reported as a
    // refusal rather than thrown: the caller answers the uniform 404 anyway.
    if (!current) return { reason: 'invalid_sql', detail: 'the dataset no longer exists' };
    if (await canWriteDataset(current, actor)) return {reason:'dataset_read_only',detail:'You no longer have edit access to a writable dataset.'};

    const catalog=catalogOf(current);
    let selected:import('@/lib/datasets/types').DatasetTable|undefined;
    let executedSql=sql;
    if(guard.source){
      try{if(!catalog)throw new Error('Dataset catalog unavailable');const compiled=compileStoredMutation(catalog,sql,table);selected=compiled.table;executedSql=compiled.sql;}
      catch(error){return {reason:'invalid_sql',detail:error instanceof Error?error.message:'Invalid stored mutation'};}
    }
    const columns = selected?.columns ?? ((current.meta as { columns?: DatasetColumn[] }).columns) ?? [];
    const rows = await loadDatasetRows(selected?{content:'',meta:{objectKey:selected.objectKey}}:current);
    const {source:_,document,...mutationGuard}=guard;
    const out = await runMutation({ table: { name: table, rows, columns }, sql:executedSql, params, ...mutationGuard, limit: datasetRowCap() });
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
    const updated = await db.transaction(async tx => {
      // Lock only for the commit, never while DuckDB runs or blobs upload.
      // Stable ordering avoids opposite document/target pairs deadlocking.
      // Sharing changes take the same parent-row lock. A separate role read
      // AFTER waiting sees the committed ACL, not the lock statement's old
      // PostgreSQL MVCC snapshot.
      const locked = await tx.query<ArtifactRow>(
        'SELECT * FROM artifacts approved_document WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE',
        [[current.id, ...(document ? [document.id] : [])]],
      );
      if (document) {
        const source = locked.rows.find(r => r.id === document.id);
        if (!source || source.deleted_at || source.edit_id !== document.editId) return {
          reason: 'document_changed', detail: 'The document changed while this mutation was running. Reload and review the current operation.',
        } satisfies MutationRefused;
        if (!canRead(await effectiveRole(source, actor, tx))) return {
          reason: 'dataset_read_only', detail: 'You no longer have access to this document.',
        } satisfies MutationRefused;
      }
      const target = locked.rows.find(r => r.id === current.id);
      if (!target || target.deleted_at || await canWriteDataset(target, actor, tx)) return {
        reason: 'dataset_read_only', detail: 'You no longer have edit access to a writable dataset.',
      } satisfies MutationRefused;
      return tx.query<ArtifactRow>(
      `WITH updated AS (
         UPDATE artifacts
            SET content = '', meta = $3::jsonb, version = version + 1, edit_id = $4, updated_at = now(), actor_user_id = $13, actor_token_id = $14
          WHERE id = $1 AND edit_id = $2 AND access = 'readwrite' AND ${scope.where('$15')}
            AND ($16::text IS NULL OR EXISTS (
              SELECT 1 FROM artifacts approved_document
              WHERE approved_document.id=$16 AND approved_document.edit_id=$17
                AND approved_document.deleted_at IS NULL
              FOR SHARE
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
        actor.userId, actor.tokenId, scope.val, document?.id ?? null, document?.editId ?? null,
      ],
      );
    });
    if ('reason' in updated) return updated;

    const row = updated.rows[0];
    if (row) {
      void trackEvent('mutate', row.id, { userId: row.user_id });
      return { row, affected: out.affected, rowCount: out.rows.length };
    }
    if (document) {
      const unchanged = await db.query('SELECT 1 FROM artifacts WHERE id=$1 AND edit_id=$2 AND deleted_at IS NULL', [document.id, document.editId]);
      if (!unchanged.rows.length) return {reason: 'document_changed', detail: 'The document changed while this mutation was running. Reload and review the current operation.'};
    }
    // Lost the CAS. Re-run against what landed — see the module doc: for DML
    // that is the same statement, not a merge.
    if (attempt >= WRITE_CAS_RETRIES) {
      return { reason: 'contended', detail: 'the dataset is being written too quickly to apply this change — try again' };
    }
  }
}

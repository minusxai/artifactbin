import { projectCommentPersons } from "../comments/retained-person-repository.ts";
import { fail } from "../errors.ts";
import { MAX_COMMENT_THREAD_RECORDS } from "./comment-thread-contracts.ts";
import { commentAttachments } from "../persistence/comment-attachments.ts";
import type { AcceptedComment, Snapshot } from "../contracts.ts";
import type { SqlClient, SqlDatabase } from "../persistence/sql.ts";
import {
  loadSession,
  loadDocumentHeader,
  lockDocumentHeader,
} from "../persistence/document-records.ts";
import { checkIdempotency, recordIdempotency } from "../persistence/idempotency.ts";
import type { SourceRequest } from "./source-repository-contracts.ts";
import type {
  CommentRepository,
  SnapshotInsert,
} from "./comment-repository-contracts.ts";
function decodeComment(r: Record<string, unknown>): AcceptedComment {
  return {
    id: r.id as string,
    nodeId: r.context_status ? null : r.node_id as string | null,
    quote: r.quote as string,
    body: r.body as string,
    sourceRevision: r.source_revision as string | null,
    ...(r.context_status ? { context: r.context_status as AcceptedComment["context"] } : {}),
    ...(r.state_replay ? {stateReplay:r.state_replay as AcceptedComment["stateReplay"]}:{}),
    parentId: r.parent_id as string | null,
    appStateId: r.app_state_id as string | null,
    publishedBy: r.published_by as string,
    createdAt: r.created_at as string,
    revision: Number(r.revision),
    resolved: r.resolved as boolean,
    fingerprint: r.fingerprint as string,
    sequence: Number(r.sequence),
  };
}
async function comment(c: SqlClient, fileId: string, id: string) {
  const row = (
    await c.query("SELECT * FROM comments WHERE file_id=$1 AND id=$2", [
      fileId,
      id,
    ])
  ).rows[0];
  if(!row)return null;
  const attachments=(await commentAttachments(c,fileId,id)).get(id);
  return (await projectCommentPersons(c,fileId,[{...decodeComment(row),...(attachments?.length?{attachments}:{})}]))[0]!;
}
async function source(c: SqlClient, fileId: string, revision: string) {
  const row = (
    await c.query(
      "SELECT revision,content FROM sources WHERE file_id=$1 AND revision=$2",
      [fileId, revision],
    )
  ).rows[0];
  return row
    ? { revision: row.revision as string, content: row.content as string }
    : null;
}
async function insertSnapshot(
  c: SqlClient,
  fileId: string,
  snapshot: SnapshotInsert,
) {
  const s = snapshot.value;
  await c.query(
    "INSERT INTO snapshots(file_id,id,source_revision,schema_version,rendered,state,view) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      fileId,
      snapshot.id,
      s.sourceRevision,
      s.schema,
      s.rendered ?? null,
      s.state,
      s.view,
    ],
  );
}
/** Each mutation locks the document after its session grant, then commits only its delta. */
export function createCommentRepository(
  database: SqlDatabase,
): CommentRepository {
  async function access(c: SqlClient, request: SourceRequest, write: boolean) {
    const session = await loadSession(c, request.tokenHash);
    const document = await (write ? lockDocumentHeader : loadDocumentHeader)(
      c,
      request.fileId,
    );
    return { session, document };
  }
  return {
    list: (request, work, since = null) =>
      database.transaction(async (c) => {
        const loaded = await access(c, request, false);
        // Writers hold the header lock until commit, so change counters become
        // visible in order and the highest one listed is a gap-free cursor.
        const rows = (
          since === null
            ? await c.query(
                "SELECT *,COALESCE(changed,sequence) AS changed_at FROM comments WHERE file_id=$1 ORDER BY sequence,id",
                [request.fileId],
              )
            : await c.query(
                "SELECT *,COALESCE(changed,sequence) AS changed_at FROM comments WHERE file_id=$1 AND COALESCE(changed,sequence)>$2 ORDER BY COALESCE(changed,sequence),id",
                [request.fileId, since],
              )
        ).rows;
        const cursor = rows.reduce(
          (latest, row) => Math.max(latest, Number(row.changed_at)),
          since ?? 0,
        );
        const attachments=await commentAttachments(c,request.fileId);
        return work({ ...loaded, comments: await projectCommentPersons(c,request.fileId,rows.map(row=>{const value=decodeComment(row);const images=attachments.get(value.id);return {...value,...(images?.length?{attachments:images}:{})};})), cursor });
      }),
    add: (baseRequest, prepare, work, idempotency = null) =>
      database.transaction(async (c) => {
        const loaded = await access(c, baseRequest, true);
        const prepared = prepare(loaded);
        const request = { ...baseRequest, ...prepared };
        const scope = idempotency && {
          fileId: request.fileId,
          actor: prepared.actor,
          key: idempotency.key,
        };
        if (scope && idempotency) {
          const decision = await checkIdempotency(
            c,
            scope,
            idempotency.fingerprint,
            idempotency.now,
          );
          if (decision.kind === "replay") return decision.body as never;
        }
        const existing = await comment(c, request.fileId, request.commentId);
        const parentExists =
          request.parentId === null
            ? false
            : !!(
                await c.query(
                  "SELECT 1 FROM comments WHERE file_id=$1 AND id=$2",
                  [request.fileId, request.parentId],
                )
              ).rows[0];
        const sourceExists = !!(
          await c.query(
            "SELECT 1 FROM sources WHERE file_id=$1 AND revision=$2",
            [request.fileId, request.sourceRevision],
          )
        ).rows[0];
        const staged = work({
          ...loaded,
          existing,
          parentExists,
          sourceExists,
        });
        if (staged.insert) {
          if (staged.insert.snapshot)
            await insertSnapshot(c, request.fileId, staged.insert.snapshot);
          const n = staged.insert.comment;
          await c.query(
            "INSERT INTO comments(file_id,id,node_id,quote,body,source_revision,parent_id,app_state_id,published_by,created_at,revision,resolved,fingerprint,sequence,changed) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)",
            [
              request.fileId,
              n.id,
              n.nodeId,
              n.quote,
              n.body,
              n.sourceRevision,
              n.parentId,
              n.appStateId,
              n.publishedBy,
              n.createdAt,
              n.revision,
              n.resolved,
              n.fingerprint,
              n.sequence,
            ],
          );
          await c.query("UPDATE files SET sequence=$2 WHERE id=$1", [
            request.fileId,
            n.sequence,
          ]);
        }
        if (scope && idempotency)
          await recordIdempotency(
            c,
            scope,
            idempotency.fingerprint,
            { status: 201, body: staged.value },
            idempotency.now,
          );
        return staged.value;
      }),
    edit: (baseRequest, prepare, work) =>
      database.transaction(async (c) => {
        const loaded = await access(c, baseRequest, true);
        const request = { ...baseRequest, ...prepare(loaded) };
        const staged = work({
          ...loaded,
          comment: await comment(c, request.fileId, request.commentId),
        });
        // Advance the page change counter so pollers see the edit once.
        const changed = (
          await c.query(
            "UPDATE files SET sequence=sequence+1 WHERE id=$1 RETURNING sequence",
            [request.fileId],
          )
        ).rows[0]?.sequence;
        await c.query(
          "UPDATE comments SET body=$3,resolved=$4,revision=$5,changed=$6 WHERE file_id=$1 AND id=$2",
          [
            request.fileId,
            request.commentId,
            staged.comment.body,
            staged.comment.resolved,
            staged.comment.revision,
            changed,
          ],
        );
        return staged.value;
      }),
    thread: (baseRequest, prepare, work) => database.transaction(async c=>{
      const loaded=await access(c,baseRequest,false);
      const request={...baseRequest,...prepare(loaded)};
      const selected=await comment(c,request.fileId,request.commentId);
      let root=selected;
      const seen=new Set<string>();
      while(root?.parentId){
        if(seen.has(root.id)){root=null;break;}
        if(seen.size>=MAX_COMMENT_THREAD_RECORDS)fail(413,"This comment thread is too large to open from a link");
        seen.add(root.id);root=await comment(c,request.fileId,root.parentId);
      }
      if(!root)return work({...loaded,selected,root:null,comments:[]});
      // UNION deduplicates corrupt cycles; LIMIT bounds traversal before sorting or attachment reads.
      const rows=(await c.query(`WITH RECURSIVE thread AS (
        SELECT * FROM comments WHERE file_id=$1 AND id=$2
        UNION SELECT child.* FROM comments child JOIN thread parent ON child.parent_id=parent.id AND child.file_id=parent.file_id
      ) SELECT * FROM thread LIMIT $3`,[request.fileId,root.id,MAX_COMMENT_THREAD_RECORDS+1])).rows;
      const notes=rows.map(decodeComment).sort((a,b)=>a.sequence-b.sequence||a.id.localeCompare(b.id));
      if(notes.length<=MAX_COMMENT_THREAD_RECORDS){
        for(const note of notes){const attachments=(await commentAttachments(c,request.fileId,note.id)).get(note.id);if(attachments?.length)note.attachments=attachments;}
      }
      return work({...loaded,selected,root,comments:await projectCommentPersons(c,request.fileId,notes)});
    }),
    context: (baseRequest, prepare, work) =>
      database.transaction(async (c) => {
        const loaded = await access(c, baseRequest, false);
        const request = { ...baseRequest, ...prepare(loaded) };
        const note = await comment(c, request.fileId, request.commentId);
        const storedSource = note?.sourceRevision
          ? await source(c, request.fileId, note.sourceRevision)
          : null;
        const row = note?.sourceRevision && note.appStateId
          ? (
              await c.query(
                "SELECT * FROM snapshots WHERE file_id=$1 AND id=$2",
                [request.fileId, note.appStateId],
              )
            ).rows[0]
          : null;
        const snapshot: Snapshot | null = row
          ? {
              schema: Number(row.schema_version),
              sourceRevision: row.source_revision as string,
              state: row.state as Snapshot["state"],
              view: row.view as Snapshot["view"],
              ...(row.rendered === null
                ? {}
                : { rendered: row.rendered as string }),
            }
          : null;
        return work({
          ...loaded,
          comment: note,
          source: storedSource,
          snapshot,
        });
      }),
    capture: (request, prepare, work) =>
      database.transaction(async (c) => {
        const loaded = await access(c, request, true),
          snapshot = prepare(loaded);
        const staged = work({
          ...loaded,
          snapshot,
          source: await source(c, request.fileId, snapshot.sourceRevision),
        });
        await insertSnapshot(c, request.fileId, staged.snapshot);
        return staged.value;
      }),
  };
}

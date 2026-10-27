/**
 * THE ANNOTATION HALF OF THE ARTIFACT WIRE — the reads that inline a document's
 * open threads and the one door that answers a thread. lib/artifacts/wire owns
 * the artifact's own shape and takes the open-thread count from its callers;
 * this module sits above it, reads the annotation store, and passes the count
 * down, so artifacts never reaches the annotation store or the remote agents.
 */
import { MembershipError } from '@/lib/artifacts';
import type { MutationReceipt } from '@/lib/artifacts';
import type { ArtifactRow } from '@/lib/artifacts';
import type { AccessActor } from '../accounts';
import { artifactToWire } from '@/lib/artifacts';
import { snapshotForReader, snapshotHeadFor } from '@/lib/artifacts';
import { json } from '../http/http';
import type { AnnotationAuthor } from '@artifactbin/contracts';
import { AnnotationAttachmentError, AnnotationRevisionError, actOnAnnotationFor, annotationsWireForRow, countOpenAnnotations, editAnnotationCommentFor, setCommentReactionFor, type AnnotationAction, type AnnotationEdit } from './store';

/**
 * The artifact GET's shape: the wire row plus the OPEN annotations inlined,
 * anchors in current coordinates. This is where "colocation" lives — the read
 * an agent already makes before editing carries the owner's feedback, so no
 * second call and no second concept exist on the read side.
 */
export async function artifactToWireWithAnnotations(row: ArtifactRow, base: string, viewerId?:string|null) {
  if (row.format !== 'markup' && row.format !== 'folder') return artifactToWire(row, base, 0);
  // The count and the threads are independent reads.
  const [open, annotations] = await Promise.all([countOpenAnnotations(row.id), annotationsWireForRow(row,undefined,viewerId)]);
  return { ...await artifactToWire(row, base, open), annotations };
}

/** Any artifact read above lib/artifacts: the wire row with its open-thread count. */
export async function artifactWireFor(row: ArtifactRow, base: string) {
  return artifactToWire(row, base, await openAnnotationsFor(row));
}

/** Only a document (markup or folder) has threads; a data tier is never counted. */
const openAnnotationsFor = (row: ArtifactRow): Promise<number> =>
  row.format === 'markup' || row.format === 'folder' ? countOpenAnnotations(row.id) : Promise.resolve(0);

/** One artifact as the bearer read door answers it: the head this reader may see, its open threads, and their capabilities. */
export async function readArtifactSnapshot(actor: AccessActor, id: string, base: string) {
  const head = await snapshotHeadFor(actor, id);
  if (!head) return null;
  const wire: Record<string, unknown> = await artifactToWireWithAnnotations(head.snapshot, base, actor.userId);
  return snapshotForReader(wire, head.row, head.role);
}

/** Body → action; null = malformed (neither field, or wrong types). */
function parseAnnotationAction(body: Record<string, unknown>): AnnotationAction | null {
  const action: AnnotationAction = {};
  if(body.expected_revision!==undefined){if(!Number.isSafeInteger(body.expected_revision)||Number(body.expected_revision)<0)return null;action.expectedRevision=Number(body.expected_revision);}
  if (typeof body.reply === 'string' && body.reply.trim().length > 0) action.reply = body.reply;
  else if (body.reply !== undefined) return null;
  if (typeof body.resolve === 'boolean') action.resolve = body.resolve;
  else if (body.resolve !== undefined) return null;
  if (typeof body.reopen === 'boolean') action.reopen = body.reopen;
  else if (body.reopen !== undefined) return null;
  if (body.attachment_id !== undefined) {
    // An image rides only on a reply, with the revision it was staged against — the root's create contract.
    if (!action.reply || typeof body.attachment_id !== 'string' || !/^cim_[a-z0-9]+$/.test(body.attachment_id) || typeof body.edit_id !== 'string' || !body.edit_id) return null;
    action.attachmentId = body.attachment_id; action.attachmentEditId = body.edit_id;
  }
  if (action.resolve && action.reopen) return null; // contradictory transitions
  if (!action.reply && !action.resolve && !action.reopen) return null; // an action that does nothing is malformed
  return action;
}

/** The ONE annotation mutation — only the credential (and thus the attribution) differs per door. */
export async function respondToAnnotationAction(
  body: Record<string, unknown> | null,
  actor: AccessActor,
  author: AnnotationAuthor,
  id: string,
  annId: string,
  receipt?:MutationReceipt,
): Promise<Response> {
  if (!body) return json({ error: 'invalid_json' }, 400);
  const action = parseAnnotationAction(body);
  if (!action) return json({ error: 'invalid_annotation_action' }, 400);
  let wire;
  try{wire = await actOnAnnotationFor(actor, id, annId, action, author,receipt);}
  catch(error){if(error instanceof AnnotationAttachmentError)return error.reason==='stale'?json({error:'stale',message:error.message,edit_id:error.head},409):json({error:'invalid_attachment',message:error.message},400);if(error instanceof AnnotationRevisionError)return json({error:'annotation_conflict',current_revision:error.revision,hint:'Read the current conversation before retrying; a state change was not applied; a plain reply never conflicts.'},409);if(error instanceof MembershipError)return json({error:'mention_refused',detail:error.message},error.status);throw error;}
  if (!wire) return json({ error: 'not_found' }, 404);
  return json(wire);
}

/** Body → edit; null = malformed (no words, or a revision that is not a count). */
function parseAnnotationEdit(body: Record<string, unknown>, editorKind: AnnotationEdit['editorKind']): AnnotationEdit | null {
  if (typeof body.body !== 'string' || body.body.trim().length === 0) return null;
  const edit: AnnotationEdit = { body: body.body, editorKind };
  if (body.expected_revision !== undefined) {
    if (!Number.isSafeInteger(body.expected_revision) || Number(body.expected_revision) < 0) return null;
    edit.expectedRevision = Number(body.expected_revision);
  }
  return edit;
}

/**
 * The ONE comment-edit door, for both credentials: `{ body, expected_revision? }` against a comment id (a thread's
 * first comment or a reply). Answers the whole thread. Not this actor's comment, or no such comment: the uniform 404.
 */
export async function respondToAnnotationEdit(
  body: Record<string, unknown> | null,
  actor: AccessActor,
  id: string,
  commentId: string,
  editorKind: AnnotationEdit['editorKind'],
  receipt?: MutationReceipt,
): Promise<Response> {
  if (!body) return json({ error: 'invalid_json' }, 400);
  const edit = parseAnnotationEdit(body, editorKind);
  if (!edit) return json({ error: 'invalid_annotation_edit', hint: 'Send the new text as a non-empty `body`; `expected_revision` is the thread revision you read.' }, 400);
  let result;
  try { result = await editAnnotationCommentFor(actor, id, commentId, edit, receipt); }
  catch (error) {
    if (error instanceof AnnotationRevisionError) return json({ error: 'annotation_conflict', current_revision: error.revision, hint: 'Read the current conversation before retrying; the comment was not changed.' }, 409);
    if (error instanceof MembershipError) return json({ error: 'mention_refused', detail: error.message }, error.status);
    throw error;
  }
  if (!result) return json({ error: 'not_found' }, 404);
  // Sessions the edit newly mentions hear about it once it has committed; an unchanged text tells no one.
  return json(result.wire);
}

/** Both account doors use the same desired-state protocol; unknown kinds fail closed until supported. */
export async function respondToCommentReaction(body:Record<string,unknown>|null,actor:AccessActor,id:string,commentId:string):Promise<Response>{
 if(!actor.userId)return json({error:'account_required',hint:'Sign in to react to comments.'},403);
 if(!body || body.kind!=='thumbs_up' || typeof body.active!=='boolean')return json({error:'invalid_comment_reaction'},400);
 const wire=await setCommentReactionFor(actor,id,commentId,{kind:body.kind,active:body.active});
 return wire?json(wire):json({error:'not_found'},404);
}

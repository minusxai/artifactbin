import {createHash} from 'node:crypto';
import {durableMutation,type MutationReceipt} from '@/lib/mutation-receipt';
import {readableArtifact} from '@/lib/artifact-read';
import {canAnnotate} from '@/lib/share-roles';
/**
 * GET /api/artifacts/:id/annotations — the annotation list, anchors in
 * CURRENT coordinates. `?status=open` (default) | `resolved` | `all`.
 *
 * This is the history/debug view; the primary read is the artifact GET
 * itself, which inlines the open set — an agent never needs a second call to
 * see the feedback. Uniform 404 for an unreachable id, like every scoped
 * read.
 */
import { createAnnotationFor, listAnnotationPageFor } from '@/lib/annotations';
import {decodePage, encodeCursor} from '@/lib/pagination';
import { withTokenAuth } from '@/lib/auth';
import { annotationAuthorForRequest } from '@/lib/annotation-author';
import { notifyRemoteComment } from '@/lib/remote/mentions';
import { json, readJson } from '@/lib/http';
import type { TokenActor } from '@/lib/artifacts';

const STATUSES = new Set(['open', 'resolved', 'all']);

/** Shared by both doors: the ?status= vocabulary and the {annotations} envelope. */
export async function respondToAnnotationList(request: Request, actor: TokenActor, id: string): Promise<Response> {
  const raw = new URL(request.url).searchParams.get('status') ?? 'open';
  if (!STATUSES.has(raw)) return json({ error: 'invalid_status' }, 400);
  const author=new URL(request.url).searchParams.get('author')??undefined;
  if(author!==undefined&&!/^[A-Za-z0-9_-]{1,128}$/.test(author))return json({error:'invalid_author'},400);
  const scope=createHash('sha256').update(JSON.stringify([id,actor.userId??actor.tokenId,raw,author])).digest('hex');
  const page = decodePage(Object.fromEntries(new URL(request.url).searchParams), 'comments');
  if (page instanceof Response) return page;
  if(page.cursor&&page.cursor.scope!==scope)return json({error:'invalid_cursor',hint:'Restart the listing without --cursor; its target or filters changed.'},400);
  const result = await listAnnotationPageFor(actor, id, {status: raw as 'open' | 'resolved' | 'all', limit: page.limit, after: page.cursor?.seq as string | undefined,author});
  if (!result) return json({ error: 'not_found' }, 404);
  return json({ annotations: result.annotations, next_cursor: result.next ? encodeCursor('comments', {seq: result.next,scope}) : null });
}

export const GET = withTokenAuth((request, { tokenId, userId, params }) =>
  respondToAnnotationList(request, { tokenId, userId }, params.id),
);

/** Agent creation uses stable node identity or a unique text quote. */
export const POST = withTokenAuth(async (request, {tokenId, userId, params, clientHarness}) => {
  const body = await readJson(request);
  if (!body) return json({error: 'invalid_json'}, 400);
  if (Object.keys(body).some(key => !['node_id', 'quote', 'body'].includes(key)) ||
    typeof body.body !== 'string' || !body.body.trim() || body.body.length > 100000 ||
    (body.node_id !== undefined && (typeof body.node_id !== 'string' || !body.node_id.trim())) ||
    (body.quote !== undefined && (typeof body.quote !== 'string' || !body.quote.trim())) ||
    (body.node_id === undefined) === (body.quote === undefined))
    return json({error: 'invalid_annotation_body', hint: 'Supply body and exactly one of node_id or quote'}, 400);
  const actor={tokenId,userId};
  const key=request.headers.get('Idempotency-Key');
  const work=async(receipt?:MutationReceipt)=>{
  const made = await createAnnotationFor({tokenId, userId}, params.id, {
    body: body.body as string, ...(typeof body.node_id === 'string' ? {nodeId: body.node_id} : {quote: body.quote as string}),
  }, annotationAuthorForRequest(request, clientHarness),receipt);
  if (made instanceof Response) return made;
  if (!made) return json({error: 'not_found'}, 404);
  if ('refused' in made) return json({error: made.refused, hint: 'Read the current document and use a unique quote or stable node_id'}, made.refused === 'stale' ? 409 : 400);
  notifyRemoteComment(userId, params.id, made.id, made.thread[0]);
  return json(made, 201);
  };
  if(!key)return work();
  const access=await readableArtifact(actor,params.id);if(!access||!canAnnotate(access.role))return json({error:'not_found'},404);
  const result=await durableMutation(actor,request.url,key,{operation:'create_comment',id:params.id,body},async receipt=>{const response=await work(receipt);return {status:response.status,body:await response.json()};});
  const terminal=!['operation_pending','outcome_unknown','idempotency_mismatch','invalid_idempotency_key'].includes(String(result.body.error));
  return json(result.body,result.status,terminal?{'X-Artifactbin-Mutation-Receipt':key}:{});
});

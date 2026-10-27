/**
 * POST /api/my/artifacts/:id/annotations/:annId — a browser reply/state transition,
 * the same protocol as the bearer twin. The current ACL admits the owner;
 * attribution remains HUMAN so future non-owner commenters fit the contract.
 */
import { deleteAnnotationFor, respondToAnnotationAction, respondToAnnotationEdit } from '@/lib/annotations';
import { capabilityGuard, durableMutation } from '@/lib/artifacts';
import { browserActor } from '@/lib/accounts';
import { json, readJson } from '@/lib/http';
import { ownerUsername } from '@/lib/accounts';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; annId: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id, annId } = await ctx.params;
  const body = await readJson(request);
  const author = { kind: 'human' as const, label: await ownerUsername(actor.userId), transport: 'browser' as const };
  // An Idempotency-Key makes a retried reply (the reader retries through a deploy restart) land once.
  const key = request.headers.get('Idempotency-Key');
  if (!key || !body) return respondToAnnotationAction(body, actor, author, id, annId);
  const result = await durableMutation(actor, request.url, key, { operation: 'annotate', id, annId, body }, async (receipt) => {
    const response = await respondToAnnotationAction(body, actor, author, id, annId, receipt);
    return { status: response.status, body: await response.json() };
  });
  return json(result.body, result.status);
}

/**
 * PATCH — rewrite the text of one comment (a thread's first comment or a reply) its author wrote: the bearer
 * twin's `edit_comment` protocol. A guest is sent to sign in, as at the create door.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string; annId: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id, annId } = await ctx.params;
  const refusal = await capabilityGuard(actor, 'comment', id);
  if (refusal) return refusal;
  const body = await readJson(request);
  const key = request.headers.get('Idempotency-Key');
  if (!key || !body) return respondToAnnotationEdit(body, actor, id, annId, 'human');
  const result = await durableMutation(actor, request.url, key, { operation: 'edit_comment', id, annId, body }, async (receipt) => {
    const response = await respondToAnnotationEdit(body, actor, id, annId, 'human', receipt);
    return { status: response.status, body: await response.json() };
  });
  return json(result.body, result.status);
}

/**
 * DELETE — erase a thread (root + replies), under the same governing-rights ACL
 * as the bearer twin.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string; annId: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id, annId } = await ctx.params;
  const deleted = await deleteAnnotationFor(actor, id, annId);
  if (!deleted) return json({ error: 'not_found' }, 404);
  return json({ ok: true });
}

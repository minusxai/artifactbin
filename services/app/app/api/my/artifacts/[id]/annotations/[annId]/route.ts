/**
 * POST /api/my/artifacts/:id/annotations/:annId — a browser reply/state transition,
 * the same protocol as the bearer twin. The current ACL admits the owner;
 * attribution remains HUMAN so future non-owner commenters fit the contract.
 */
import { deleteAnnotationFor, respondToAnnotationAction } from '@/lib/annotations';
import { browserActor } from '@/lib/accounts';
import { json, readJson } from '@/lib/http';
import { ownerUsername } from '@/lib/accounts';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; annId: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id, annId } = await ctx.params;
  return respondToAnnotationAction(await readJson(request), actor, {
    kind: 'human', label: await ownerUsername(actor.userId), transport: 'browser',
  }, id, annId);
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

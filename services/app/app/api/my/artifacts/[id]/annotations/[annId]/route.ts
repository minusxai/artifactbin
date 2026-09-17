/**
 * POST /api/my/artifacts/:id/annotations/:annId — a browser reply/state transition,
 * the same protocol as the bearer twin. The current ACL admits the owner;
 * attribution remains HUMAN so future non-owner commenters fit the contract.
 */
import { respondToAnnotationAction } from '@/lib/artifact-wire';
import { deleteAnnotationFor } from '@/lib/annotations';
import { browserActor } from '@/lib/auth';
import { json, readJson, unauthorized } from '@/lib/http';
import { ownerUsername } from '@/lib/users';
import { actorForArtifacts } from '@/lib/viewer';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; annId: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const { id, annId } = await ctx.params;
  return respondToAnnotationAction(await readJson(request), scoped, {
    kind: 'human', label: await ownerUsername(scoped.userId), transport: 'browser',
  }, id, annId);
}

/**
 * DELETE — erase a thread (root + replies). The OWNER's verb, deliberately
 * absent from the bearer door: an agent may answer feedback, never erase it.
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string; annId: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const { id, annId } = await ctx.params;
  const deleted = await deleteAnnotationFor(scoped, id, annId);
  if (!deleted) return json({ error: 'not_found' }, 404);
  return json({ ok: true });
}

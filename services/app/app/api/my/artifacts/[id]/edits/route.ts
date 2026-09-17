/**
 * POST /api/my/artifacts/:id/edits — the session-authed twin of the bearer
 * edits route. Identical protocol and identical answers; only the ownership
 * scope differs (account instead of creating token), so a signed-in human
 * editing in the browser and an agent holding a token speak the same wire.
 */
import { respondToEdit } from '@/lib/artifact-wire';
import { applyEditFor } from '@/lib/artifacts';
import { browserActor } from '@/lib/auth';
import { actorForArtifacts } from '@/lib/viewer';
import { baseUrl, readJson, unauthorized } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const { id } = await ctx.params;
  return respondToEdit(baseUrl(request), await readJson(request), (input) => applyEditFor(scoped, id, input));
}

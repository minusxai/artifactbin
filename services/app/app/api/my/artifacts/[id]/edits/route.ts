/**
 * POST /api/my/artifacts/:id/edits — the session-authed twin of the bearer
 * edits route. Identical protocol; only the ownership scope differs (account
 * instead of creating token), so a signed-in human editing in the browser and an
 * agent holding a token speak the same wire. One answer differs: an edit applied
 * on the version it was prepared against answers with its patch instead of the
 * whole document graph (`?echo=full` asks for the bearer route's full answer).
 */
import { respondToEdit } from '@/lib/artifacts';
import { applyEditFor } from '@/lib/artifacts';
import { browserActor } from '@/lib/accounts';
import { actorForArtifacts } from '@/lib/accounts';
import { baseUrl, readJson, unauthorized } from '@/lib/http';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const { id } = await ctx.params;
  const echo = new URL(request.url).searchParams.get('echo') === 'full' ? 'full' : 'patch';
  return respondToEdit(baseUrl(request), await readJson(request), (input) => applyEditFor(scoped, id, input), echo);
}

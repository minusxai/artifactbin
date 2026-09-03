import { forkArtifact, getArtifactById } from '@/lib/artifacts';
import { browserActor } from '@/lib/auth';
import { canRead } from '@/lib/share-roles';
import { roleFor } from '@/lib/viewer';
import { ensureUserToken } from '@/lib/tokens';
import { ownerUsername } from '@/lib/users';
import { canonicalArtifactPath } from '@/lib/urls';
import { baseUrl, json } from '@/lib/http';

/**
 * POST /api/my/artifacts/:id/fork — "make this mine".
 *
 * A BROWSER credential only: forking is a person's act from the page, not an
 * agent verb, which is why it is deliberately absent from the operations
 * registry (and so from the bearer routes and MCP) in this phase.
 *
 * Reach is READ, not ownership — you fork what you can see, so the miss is the
 * uniform 404 for an id that is unknown AND for one this viewer may not read;
 * the two must stay indistinguishable or the door is an existence oracle. An
 * anonymous browser is refused separately (409) because a fork needs an owner
 * and there is no account to be one — never a silent anonymous copy.
 *
 * The copy is owned by the session's own account token (ensureUserToken, as
 * every other browser create does), and the URL handed back is the canonical
 * one for its NEW owner.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const row = await getArtifactById(id);
  if (!row || !canRead(await roleFor(row, actor))) return json({ error: 'not_found' }, 404);
  const userId = actor.viewer?.userId;
  if (!userId) return json({ error: 'sign_in_required' }, 409);

  const copy = await forkArtifact({ tokenId: await ensureUserToken(userId), userId }, row);
  // A publish refusal (an unownable <Mutation> target, an unreadable ref) is
  // passed through by name — it tells the forker exactly what stopped it.
  if (copy instanceof Response) return copy;
  return json({ id: copy.id, url: `${baseUrl(request)}${canonicalArtifactPath(copy, await ownerUsername(userId))}` }, 201);
}

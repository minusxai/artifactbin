import { forkArtifact, getArtifactById } from '@/lib/artifacts';
import { browserActor } from '@/lib/auth';
import { canRead } from '@/lib/share-roles';
import { roleFor } from '@/lib/viewer';
import { ensureUserToken } from '@/lib/tokens';
import { ownerUsername } from '@/lib/users';
import { canonicalArtifactPath } from '@/lib/urls';
import { baseUrl, json } from '@/lib/http';

/**
 * POST /api/my/artifacts/:id/fork — "make this mine", from the PAGE.
 *
 * Forking has two doors over one `forkArtifact`: this one, which a person
 * clicks (a session credential, no overrides — the copy opens in the editor,
 * where renaming and filing it are the next thing they do), and the
 * `fork_artifact` OPERATION (lib/operations/registry), which a bearer agent
 * calls and which carries the title/visibility/parent_id overrides an agent has
 * no editor to apply. The two differ in exactly three ways — the credential,
 * the 409 below, and the shape of the answer — and in nothing else, because
 * everything a fork MEANS lives in `forkArtifact`.
 *
 * Reach is READ, not ownership — you fork what you can see, so the miss is the
 * uniform 404 for an id that is unknown AND for one this viewer may not read;
 * the two must stay indistinguishable or the door is an existence oracle. An
 * anonymous browser is refused separately (409) because a fork needs an owner
 * and there is no account to be one — never a silent anonymous copy.
 *
 * The copy is owned by the session's own account token (ensureUserToken, as
 * every other browser create does), and the URL handed back is the canonical
 * one for its NEW owner — where the operation answers the create reply, since
 * an agent's next call is the edit loop rather than a navigation.
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

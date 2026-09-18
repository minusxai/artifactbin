import { forkArtifact, forkDatasetPreview, forkRefusal, getArtifactById } from '@/lib/artifacts';
import { forkOwner } from '@/lib/operations/registry';
import { capabilityGuard } from '@/lib/capabilities';
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
 *
 * `{"dry_run": true}` answers what forking would COPY — the datasets this page
 * writes and the forker does not own — and creates nothing. The dialog asks
 * before it offers the button, because "fork this" and "fork this and take
 * three datasets of your own" are different acts and only one of them is what
 * the word alone promises.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const row = await getArtifactById(id);
  if (!row || !canRead(await roleFor(row, actor))) return json({ error: 'not_found' }, 404);
  const userId = actor.viewer?.userId;
  if (!userId) return json({ error: 'sign_in_required' }, 409);
  // A guest is sent to sign in by the line above; a TEST USER holds an account
  // id and is still refused — it forks inside its sandbox and nowhere else.
  const sandbox = await capabilityGuard({ userId, tokenId: actor.tokenId }, 'fork', id);
  if (sandbox) return sandbox;
  const tokenId = await ensureUserToken(userId);
  // A body is optional here (the control row sends none), so an unreadable one
  // is simply "no options" rather than a 400: this door has no overrides to
  // silently drop, which is the hazard the operation's door answers 400 for.
  const body = (await request.json().catch(() => null)) as { dry_run?: unknown; as?: unknown } | null;
  // `as: {testuser}` — the ONE door from the real world into a test user's
  // sandbox, and it is the same rule at both fork doors: read, refs and the
  // artifact quota stay the account's, and only the OWNER of the copy changes.
  const owner = await forkOwner({ tokenId, userId }, body?.as);
  if ('error' in owner) return json({ error: owner.error, message: owner.message }, owner.status);
  if (body?.dry_run === true) {
    const unforkable = forkRefusal(row);
    if (unforkable) return unforkable;
    return json({ datasets: await forkDatasetPreview({ tokenId, userId }, row, owner.actor), ...(owner.testuser ? { owner: owner.testuser } : {}) }, 200);
  }

  const copy = await forkArtifact({ tokenId, userId }, row, {}, owner.actor);
  // A publish refusal (an unownable <Mutation> target, an unreadable ref) is
  // passed through by name — it tells the forker exactly what stopped it.
  if (copy instanceof Response) return copy;
  // The copy's canonical path is its OWNER's; a sandbox copy is addressed by
  // the test user that holds it, and the reply names that person so the caller
  // never has to look up who a copy belongs to.
  return json({
    id: copy.artifact.id,
    url: `${baseUrl(request)}${canonicalArtifactPath(copy.artifact, await ownerUsername(owner.actor.userId))}`,
    ...(owner.testuser ? { owner: owner.testuser } : {}),
  }, 201);
}

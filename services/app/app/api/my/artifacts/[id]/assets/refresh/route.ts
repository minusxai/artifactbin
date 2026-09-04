import { browserActor } from '@/lib/auth';
import { actorForArtifacts } from '@/lib/viewer';
import { refreshAssetsFor } from '@/lib/artifact-wire';
import { unauthorized } from '@/lib/http';

/**
 * POST /api/my/artifacts/:id/assets/refresh — "refresh external images", from
 * the owner's own menu.
 *
 * The browser twin of the `refresh_asset` operation, over the SAME pipeline
 * (lib/artifact-wire refreshAssetsFor): a person clicking a row and an agent
 * calling the tool must not be able to mean different things. It differs only
 * in the credential — a session or the agent cookie, never a bearer token —
 * which is what makes it safe to reach from a page.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const { id } = await ctx.params;
  return refreshAssetsFor(scoped, { id });
}

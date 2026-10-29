import { browserActor } from '@/lib/authentication';
import { refreshAssetsFor } from '@/lib/publish';

/**
 * POST /api/my/artifacts/:id/assets/refresh — "refresh external images", from
 * the owner's own menu.
 *
 * The browser twin of the `refresh_asset` operation, over the SAME pipeline
 * (lib/publish/publish refreshAssetsFor): a person clicking a row and an agent
 * calling the tool must not be able to mean different things. It differs only
 * in the credential — a session or the agent cookie, never a bearer token —
 * which is what makes it safe to reach from a page.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  return refreshAssetsFor(actor, { id });
}

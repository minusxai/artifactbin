import { listVersionsFor } from '@/lib/artifacts';
import { browserActor } from '@/lib/auth';
import { actorForArtifacts } from '@/lib/viewer';
import { json, unauthorized } from '@/lib/http';

/** GET /api/my/artifacts/:id/versions — owner-scoped version history. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const { id } = await ctx.params;
  const versions = await listVersionsFor(scoped, id);
  if (!versions) return json({ error: 'not_found' }, 404);
  return json({ versions });
}

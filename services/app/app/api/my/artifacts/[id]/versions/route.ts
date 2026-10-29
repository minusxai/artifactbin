import { listVersionsFor } from '@/lib/artifacts';
import { browserActor } from '@/lib/authentication';
import { json } from '@/lib/http';

/** GET /api/my/artifacts/:id/versions — owner-actor version history. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  const versions = await listVersionsFor(actor, id);
  if (!versions) return json({ error: 'not_found' }, 404);
  return json({ versions });
}

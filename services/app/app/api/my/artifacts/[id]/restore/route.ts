import { browserActor } from '@/lib/auth';
import { json, unauthorized } from '@/lib/http';
import { restoreArtifactFor } from '@/lib/trash';
import { actorForArtifacts } from '@/lib/viewer';

/**
 * POST /api/my/artifacts/:id/restore — take a row of YOUR OWN back out of the
 * trash, from the trash page.
 *
 * Owner scope, either browser credential, and the uniform 404 for an id that
 * is unknown, foreign, or simply not in the trash — the same three facts every
 * other /api/my miss conflates, and for the same reason.
 *
 * The answer says where the row LANDED (`parent_id`), because it is not always
 * where it was: a row whose folder is itself still in the trash comes back at
 * the root, and a page that assumed otherwise would draw it into a folder the
 * reader cannot open.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const { id } = await ctx.params;
  const restored = await restoreArtifactFor(scoped, id);
  if (!restored) return json({ error: 'not_found' }, 404);
  return json({ id: restored.id, url: `/a/${restored.id}`, parent_id: restored.ancestor_ids.at(-1) ?? null, ancestor_ids: restored.ancestor_ids });
}

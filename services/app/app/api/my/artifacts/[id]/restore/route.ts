import { browserActor } from '@/lib/authentication';
import { json } from '@/lib/http';
import { restoreArtifactFor } from '@/lib/workspace';
import { ScheduleLimitError } from '@/lib/artifacts';

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
  const { id } = await ctx.params;
  let restored: Awaited<ReturnType<typeof restoreArtifactFor>>;
  try { restored = await restoreArtifactFor(actor, id); }
  catch (error) { if (error instanceof ScheduleLimitError) return json({ error: error.code, details: [error.message] }, error.status); throw error; }
  if (!restored) return json({ error: 'not_found' }, 404);
  return json({ id: restored.id, url: `/a/${restored.id}`, parent_id: restored.ancestor_ids.at(-1) ?? null, ancestor_ids: restored.ancestor_ids });
}

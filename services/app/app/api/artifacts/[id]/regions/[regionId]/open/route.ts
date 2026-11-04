/** POST /api/artifacts/:id/regions/:regionId/open — a live session of one region (contract RegionOpenReply). */
import { answer, browserEditor, regionSessions } from '../../doors';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; regionId: string }> }) {
  const actor = await browserEditor(request);
  if (actor instanceof Response) return actor;
  const { id, regionId } = await ctx.params;
  return answer(await regionSessions().open(actor, id, regionId));
}

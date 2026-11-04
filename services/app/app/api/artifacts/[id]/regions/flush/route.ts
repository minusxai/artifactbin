/** POST /api/artifacts/:id/regions/flush — every region's unsaved edits saved as one page version (contract RegionFlushReply). */
import { answer, editorOrAgent, regionSessions } from '../doors';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await editorOrAgent(request);
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  return answer(await regionSessions().flush(actor, id));
}

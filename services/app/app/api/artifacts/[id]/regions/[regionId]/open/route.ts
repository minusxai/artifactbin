/**
 * POST /api/artifacts/:id/regions/:regionId/open — a live session of one region (contract RegionOpenReply), or of one
 * dataset text cell the page links (`regionId` a cell key, contract CellScope).
 */
import { isCellKey } from '@artifactbin/contracts';
import { answer, browserEditor, regionSessions } from '../../doors';

export async function POST(request: Request, ctx: { params: Promise<{ id: string; regionId: string }> }) {
  const actor = await browserEditor(request);
  if (actor instanceof Response) return actor;
  const { id, regionId } = await ctx.params;
  if (isCellKey(regionId)) return answer(await regionSessions().cells.open(actor, id, regionId));
  return answer(await regionSessions().open(actor, id, regionId));
}

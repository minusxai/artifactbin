/**
 * POST /api/artifacts/:id/regions/flush — every region's unsaved edits saved as one page version (contract
 * RegionFlushReply). An agent's bearer call is the save_regions operation (lib/operations); the page's own
 * save-before-comment is the browser editor's, same-origin. `?scope=cells` saves the dataset text cells the browser
 * reader may write, of every dataset the page links (`{saved}`: how many dataset versions it made).
 */
import { runOperation } from '@/lib/operations';
import { answer, editorOrAgent, regionSessions } from '../doors';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await editorOrAgent(request);
  if (actor instanceof Response) return actor;
  const { id } = await ctx.params;
  if (actor.credential === 'bearer') return runOperation('save_regions', request, actor, { id });
  if (new URL(request.url).searchParams.get('scope') === 'cells') return answer(await regionSessions().cells.flush(actor, id));
  return answer(await regionSessions().flush(actor, id));
}

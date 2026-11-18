/**
 * DELETE /api/artifacts/:id/query-approvals/:approvalId — an Admin of the group that owns the page revokes an approval
 * (lib/query-approvals): from the next read its query runs as each reader again. Audited; 404 when none was live.
 */
import { json } from '@/lib/http';
import { requestActor } from '@/lib/authentication';
import { QueryApprovalError, revokePageQuery } from '@/lib/query-approvals';

export async function DELETE(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const actor = await requestActor(request); if (actor instanceof Response) return actor;
  const { id, approvalId } = await ctx.params;
  try { return await revokePageQuery(actor, String(id), String(approvalId)) ? new Response(null, { status: 204 }) : json({ error: 'not_found' }, 404); }
  catch (error) { if (error instanceof QueryApprovalError) return json(error.body, error.status); throw error; }
}

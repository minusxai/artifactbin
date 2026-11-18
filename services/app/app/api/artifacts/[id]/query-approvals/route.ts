/**
 * GET /api/artifacts/:id/query-approvals — for an Admin of the group that owns the page (direct, or through an
 * ancestor): each query the page declares on a `default:` link, its hash, what readers would see once it is approved
 * (`statement`) and its approval if one holds (lib/query-approvals). POST `{query, hash}` — that Admin approves the
 * query whose hash they were shown: it then runs as the group, at member level, for every reader of the page, until
 * it is edited, revoked, the page moves or the approver is no longer Admin. A person, by browser or token; never a
 * group's agent (server/group-admission lists no such route, and the library refuses one too).
 */
import { json, readJson } from '@/lib/http';
import { requestActor } from '@/lib/authentication';
import { QueryApprovalError, approvePageQuery, pageQueryApprovals } from '@/lib/query-approvals';

const refused = (error: unknown) => { if (error instanceof QueryApprovalError) return json(error.body, error.status); throw error; };

export async function GET(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const actor = await requestActor(request); if (actor instanceof Response) return actor;
  try { return json(await pageQueryApprovals(actor, String((await ctx.params).id))); } catch (error) { return refused(error); }
}

export async function POST(request: Request, ctx: { params: Promise<Record<string, string>> }) {
  const actor = await requestActor(request); if (actor instanceof Response) return actor;
  const body = await readJson(request).catch(() => null) as { query?: unknown; hash?: unknown } | null;
  if (!body) return json({ error: 'invalid_json' }, 400);
  try { return json(await approvePageQuery(actor, String((await ctx.params).id), body), 201); } catch (error) { return refused(error); }
}

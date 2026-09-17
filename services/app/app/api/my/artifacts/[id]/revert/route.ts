import {runOperation} from '@/lib/operations/http';
import { browserActor } from '@/lib/auth';
import { actorForArtifacts } from '@/lib/viewer';
import { json, readJson, unauthorized } from '@/lib/http';

/** POST /api/my/artifacts/:id/revert { version } — owner-scoped revert. */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const body = await readJson(request);
  if (!body || typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 1) {
    return json({ error: 'version_required' }, 400);
  }
  const { id } = await ctx.params;
  return runOperation('revert_artifact',request,scoped,{...body,id});
}

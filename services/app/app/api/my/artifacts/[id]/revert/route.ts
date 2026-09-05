import { isVersionNotArchived, revertArtifactFor } from '@/lib/artifacts';
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
  const row = await revertArtifactFor(scoped, id, body.version);
  if (isVersionNotArchived(row)) {
    if(row.refusal) return row.refusal;
    if(row.conflictVersion!==undefined) return json({error:'version_conflict',currentVersion:row.conflictVersion},409);
    return json({ error: 'version_not_archived' }, 409);
  }
  if (!row) return json({ error: 'not_found' }, 404);
  return json({ ok: true, version: row.version });
}

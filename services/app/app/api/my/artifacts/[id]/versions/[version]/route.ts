import { getVersionFor, refusingUnservable, versionToWire } from '@/lib/artifacts';
import { browserActor } from '@/lib/accounts';
import { actorForArtifacts } from '@/lib/accounts';
import { json, unauthorized } from '@/lib/http';

/** GET /api/my/artifacts/:id/versions/:version — owner-scoped version content. */
export async function GET(request: Request, ctx: { params: Promise<{ id: string; version: string }> }) {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const { id, version } = await ctx.params;
  const v = Number(version);
  if (!Number.isInteger(v) || v < 1) return json({ error: 'not_found' }, 404);
  // Same wire as the token route, and the same 410 for a version this server no longer serves.
  return refusingUnservable(async () => {
    const row = await getVersionFor(scoped, id, v);
    return row ? json(versionToWire(row)) : json({ error: 'not_found' }, 404);
  });
}

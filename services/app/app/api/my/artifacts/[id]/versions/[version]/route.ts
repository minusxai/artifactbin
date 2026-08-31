import { getVersionFor } from '@/lib/artifacts';
import { browserActor } from '@/lib/auth';
import { actorForArtifacts } from '@/lib/viewer';
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
  const row = await getVersionFor(scoped, id, v);
  if (!row) return json({ error: 'not_found' }, 404);
  // Same wire as the token route: `content` under its own name, `markup` for
  // the source. Echoing it as `html` named a tier that no longer exists.
  return json({ ...row, markup: row.source, source: undefined });
}

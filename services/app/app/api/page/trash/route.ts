/**
 * The trash page's data: the rows this account has deleted and not yet lost.
 *
 * Its own page endpoint rather than a flag on /api/page/home, because every
 * other read in this product goes through the trash gate and returns nothing
 * here — the trash is the one listing that reads past it (lib/trash), and
 * giving it its own address keeps that exception in one place.
 */
import { json, unauthorized } from '@/lib/http';
import { listTrashFor } from '@/lib/trash';
import { actorForArtifacts, sessionActor } from '@/lib/viewer';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const scoped = actorForArtifacts(actor);
  if (!scoped) return unauthorized(request);
  const files = await listTrashFor(scoped);
  return json({ files }, 200, { 'Cache-Control': 'no-store' });
}

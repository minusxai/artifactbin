/**
 * The owner's supporting files, separate from the document shelf. The payload
 * includes folders solely as move-picker destinations; they are not rows in
 * the assets table.
 */
import { json, unauthorized } from '@/lib/http';
import { listArtifactsByUser } from '@/lib/users';
import { sessionActor } from '@/lib/viewer';

export async function GET(request: Request) {
  const actor = await sessionActor(request);
  const userId = actor.credential === 'session' ? actor.viewer?.userId : null;
  if (!userId) return unauthorized(request);

  const artifacts = await listArtifactsByUser(userId);
  const row = (artifact: (typeof artifacts)[number]) => ({
    id: artifact.id,
    url: `/a/${artifact.id}`,
    title: artifact.title,
    format: artifact.format,
    version: artifact.version,
    ancestor_ids: artifact.ancestor_ids,
    visibility: artifact.visibility,
    updated_at: artifact.updated_at,
  });

  return json({
    assets: artifacts.filter((artifact) => artifact.format !== 'markup' && artifact.format !== 'folder').map(row),
    folders: artifacts.filter((artifact) => artifact.format === 'folder').map(row),
  }, 200, { 'Cache-Control': 'no-store' });
}

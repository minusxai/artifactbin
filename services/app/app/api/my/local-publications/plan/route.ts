/** Read-only dependency planning: no reservation, upload, artifact or sharing mutation. */
import { browserActor } from '@/lib/accounts';
import { inspectPublicationBundle, type PublicationBundle } from '@/lib/html-publication-bundle';
import { PUBLISH_BODY_LIMIT, json, readJson } from '@/lib/http';
export async function POST(request: Request): Promise<Response> {
  const actor = await browserActor(request);
  if (actor instanceof Response) return actor;
  if (!actor.userId) return json({ error: 'unauthorized' }, 401);
  const body = await readJson(request, { limit: PUBLISH_BODY_LIMIT });
  if (!body || typeof body.html !== 'string' || !body.publicationBundle || typeof body.publicationBundle !== 'object') return json({ error: 'invalid_publication_bundle' }, 400);
  try { return json(inspectPublicationBundle(body.html, body.publicationBundle as PublicationBundle)); }
  catch (cause) { return json({ error: 'unresolved_publication_dependencies', details: [cause instanceof Error ? cause.message : 'Could not resolve the selected files.'] }, 400); }
}

/** Browser view admission: readable markup only, excluding capture requests.
 * Analytics owns persistence and daily visitor deduplication; callers only map
 * this result to HTTP. Both anonymous and signed-in readers are admitted.
 */
import { trackEvent } from '@/lib/analytics';
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { isCrossSiteRequest } from '@/lib/http';
import { sessionActor } from '@/lib/viewer';

export async function recordArtifactView(request: Request, id: string): Promise<'accepted' | 'not_found' | 'forbidden'> {
  // Anonymous readers report too, so apply the origin check without requiring
  // a cookie credential. This endpoint is called only from the app origin.
  if (isCrossSiteRequest(request)) return 'forbidden';
  const actor = await sessionActor(request);
  const artifact = await getArtifactById(id);
  if (!artifact || artifact.format !== 'markup' || !(await canReadArtifact(artifact, actor.viewer))) return 'not_found';
  if (!new URL(request.url).searchParams.has('key')) {
    await trackEvent('view', artifact.id, { userId: actor.viewer?.userId ?? null });
  }
  return 'accepted';
}

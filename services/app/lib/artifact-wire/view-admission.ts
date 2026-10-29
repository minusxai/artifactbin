/** Browser view admission: readable native HTML only, excluding capture requests.
 * Analytics owns persistence and daily visitor deduplication; callers only map
 * this result to HTTP. Both anonymous and signed-in readers are admitted.
 */
import { trackEvent } from '@/lib/analytics';
import { canReadArtifact, getArtifactHeaderById } from '@/lib/artifacts';
import { isCrossSiteRequest } from '@/lib/http';
import type { AccessActor } from '@/lib/accounts';

/** `reader` resolves the session door's actor (lib/authentication `sessionActor`), asked after the origin check. */
export async function recordArtifactView(request: Request, id: string, reader: () => Promise<AccessActor>): Promise<'accepted' | 'not_found' | 'forbidden'> {
  // Anonymous readers report too, so apply the origin check without requiring
  // a cookie credential. This endpoint is called only from the app origin.
  if (isCrossSiteRequest(request)) return 'forbidden';
  const actor = await reader();
  // The header decides (format and access): a view is never a reason to read the document itself.
  const artifact = await getArtifactHeaderById(id);
  if (!artifact || artifact.format !== 'html' || !(await canReadArtifact(artifact, actor))) return 'not_found';
  if (!new URL(request.url).searchParams.has('key')) {
    await trackEvent('view', artifact.id, { userId: actor.userId });
  }
  return 'accepted';
}

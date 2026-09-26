/** Authorize and resolve an image, then redirect to a scoped persistent asset.
 * Editor previews return ephemeral bytes. The operations API keeps its binary adapter. */
import { trackEvent } from '@/lib/analytics';
import { archivedVersionFor, servedRow } from '@/lib/archived-version';
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { requestOrSessionActor, roleFor } from '@/lib/viewer';
import { exportImageResponse } from '@/lib/export';
import { baseUrl, json } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { canEdit } from '@/lib/share-roles';

/**
 * `delivery: 'bytes'` is for a caller that cannot follow the redirect to the
 * export asset: a custom domain's home page (server/custom-host), whose
 * thumbnails must come from that host alone.
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }>; delivery?: 'bytes' }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const artifact = await getArtifactById(id);
  if (!artifact) return json({ error: 'not_found' }, 404);
  // Bearer OR browser credential (session, or the agent cookie): an agent
  // curls this with the token it published under (a private doc's own token
  // must be able to export it), a human arrives with whichever cookie they
  // hold, an unfurler with neither. Direct token ownership counts — an
  // unclaimed token's doc has no viewer.userId to match.
  const actor = await requestOrSessionActor(request);
  const { viewer, tokenId } = actor;
  const authorized = tokenId === artifact.token_id || (await canReadArtifact(artifact, viewer));
  if (!authorized) return json({ error: 'not_found' }, 404);
  const q = new URL(request.url).searchParams;
  /*
   * `?version=N` — photograph the document AS IT WAS. The version ACL runs
   * HERE, not in lib/export and not in the render: the signed key the headless
   * browser carries is scoped to the ARTIFACT rather than to a version, so this
   * is the last place an actor is in hand. Same rule as the served document
   * (lib/archived-version) and the same uniform 404 — a reader who may see this
   * artifact but not its history learns nothing, here either.
   */
  const at = await archivedVersionFor(request, artifact);
  if (at === 'not_found') return json({ error: 'not_found' }, 404);
  // The framing overview is editing chrome, not a public export surface.
  if (q.get('mode') === 'preview') {
    if (artifact.format !== 'markup' || !canEdit(await roleFor(artifact, actor))) {
      return json({ error: 'not_found' }, 404);
    }
  }
  // Post-ACL, pre-render: an export event is "an authorized image was asked
  // for" (link unfurls land here), whether or not the shot succeeds.
  void trackEvent('export', artifact.id, { userId: viewer?.userId ?? null });

  // `search` carries the reader's `<Value>` picks straight through to the page
  // this shoots (lib/story/url-values) — the raw route is the one door that
  // validates them, so an export cannot disagree with what it photographs.
  // Installed older CLIs reject redirects. They keep the streaming binary
  // adapter until they advertise support; browser/OG URLs use redirects.
  const delivery=ctx.delivery??(request.headers.has('X-Artifactbin-Protocol')&&request.headers.get('X-Artifactbin-Export-Delivery')!=='redirect'?'bytes':'redirect');
  // The ARCHIVED shot photographs that version's own source — the selection and
  // the social crop are read from the markup being shot, not from the head's.
  return exportImageResponse(await servedRow(artifact, at), {
    ...(at ? { version: at.version } : {}),
    refresh: q.get('refresh'),
    format: q.get('format'),
    mode: q.get('mode'),
    slide: q.get('slide'),
    crop: q.get('crop'),
    image: q.get('image'),
    search: new URL(request.url).search,
  }, baseUrl(request), delivery);
}

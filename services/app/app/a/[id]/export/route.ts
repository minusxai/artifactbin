/**
 * GET /a/:id/export?format=png|jpg — the artifact as image bytes, rendered
 * on demand server-side (nothing persisted). Curlable, subject to the same
 * read access as the page it shoots. The render/response core is shared with
 * the `export_artifact` MCP operation (lib/export exportImageResponse); this
 * route owns only the transport half — resolving the caller's credential.
 *
 * A sub-path rather than a query on the page, for the same reason as ./raw:
 * a page cannot return bytes. The render target is `/a/<id>` — the one
 * shareable URL — so this keeps working whether that URL renders the document
 * itself or redirects to it.
 */
import { trackEvent } from '@/lib/analytics';
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { requestOrSessionActor, roleFor } from '@/lib/viewer';
import { exportImageResponse } from '@/lib/export';
import { baseUrl, json } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { canEdit } from '@/lib/share-roles';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
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
  return exportImageResponse(artifact, {
    format: q.get('format'),
    mode: q.get('mode'),
    slide: q.get('slide'),
    crop: q.get('crop'),
    image: q.get('image'),
    search: new URL(request.url).search,
  }, baseUrl(request));
}

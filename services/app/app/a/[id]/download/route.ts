/** One portable HTML attachment, admitted on the same terms as viewing its page and revision. */
import { archivedVersionFor, readableArtifact, refusingUnservable, servedRow } from '@/lib/artifacts';
import { requestOrSessionActor } from '@/lib/authentication';
import { nativeHtmlTitle, offlineCopy } from '@/lib/document-serving';
import { designSystemChoice } from '@/lib/html-systems';
import { baseUrl, json } from '@/lib/http';
import { ID_RE } from '@/lib/platform';

const refusalStatus = { not_found: 404, too_large: 413, unsupported_image: 415, offline_dependency_unavailable: 422 } as const;

/** A filename every OS accepts, from the document's title. */
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'artifact'}.html`;

export function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return refusingUnservable(() => download(request, ctx));
}

async function download(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404);
  const actor = await requestOrSessionActor(request);
  const artifact = (await readableArtifact(actor, id, { admission: 'door', formats: ['html'] }))?.row;
  if (!artifact) return json({ error: 'not_found' }, 404);
  const at = await archivedVersionFor(request, artifact, async () => actor);
  if (at === 'not_found') return json({ error: 'not_found' }, 404);

  const row = { ...servedRow(artifact, at), version: at?.version ?? artifact.version };
  const copy = await offlineCopy(request, actor, row, new URL(baseUrl(request)).origin, designSystemChoice(artifact.meta));
  if ('error' in copy) return json({ error: copy.error }, refusalStatus[copy.error]);

  const name = fileName(nativeHtmlTitle(row));
  return new Response(copy.html, { headers: {
    'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
  } });
}

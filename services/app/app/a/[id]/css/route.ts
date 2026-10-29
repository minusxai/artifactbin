/**
 * GET /a/:id/css?v=<version>&k=<compile environment>&x=<classes> — A DOCUMENT'S WHOLE SHEET WITH THE CLASSES ITS DATA
 * BROUGHT (lib/document-serving/runtime-css.server). The page asks once its rows name a class its served sheet has no rule for,
 * and swaps its Tailwind sheet for this answer (lib/islands/runtime-css).
 *
 * The same read ACL as the page (the fetch door's: the owning token, or `canReadArtifact`), the uniform 404, and an
 * older version only for a reader who may read history. The answer is `text/css`, immutable for its URL, ETagged; an
 * anonymous answer carries `*` for the sandboxed copy's opaque origin, and on a document's own origin server/pages-host
 * answers its credentialed CORS.
 */
import { ANONYMOUS_ACTOR, requestOrSessionActor } from '@/lib/accounts';
import { archivedVersionForActor, canReadArtifact, getArtifactById, refusingUnservable, servedRow, holdsCreatingToken } from '@/lib/artifacts';
import { json } from '@/lib/http';
import { matchingTag } from '@/lib/http/revalidation';
import { ID_RE } from '@/lib/platform';
import { parseRuntimeCssRequest, runtimeCssAnswer } from '@/lib/document-serving';

const NO_STORE = { 'Cache-Control': 'no-store' };

export function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return refusingUnservable(() => runtimeCss(request, ctx), NO_STORE);
}

async function runtimeCss(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404, NO_STORE);
  const artifact = await getArtifactById(id);
  if (!artifact || artifact.format !== 'markup') return json({ error: 'not_found' }, 404, NO_STORE);
  const actor = await requestOrSessionActor(request);
  if (!holdsCreatingToken(artifact, actor) && !(await canReadArtifact(artifact, actor))) return json({ error: 'not_found' }, 404, NO_STORE);

  const asked = parseRuntimeCssRequest(new URL(request.url));
  if ('error' in asked) return json({ error: asked.error }, 400, NO_STORE);
  const at = asked.version === artifact.version ? null : await archivedVersionForActor(actor, artifact, asked.version);
  if (at === 'not_found') return json({ error: 'not_found' }, 404, NO_STORE);
  const row = servedRow(artifact, at);

  const anyone = await canReadArtifact(artifact, ANONYMOUS_ACTOR);
  const answer = await runtimeCssAnswer(row, asked, anyone && !at);
  const anonymous = !actor.userId && !actor.tokenId;
  const headers: Record<string, string> = {
    ETag: answer.etag,
    'Cache-Control': answer.cacheControl,
    'X-Content-Type-Options': 'nosniff',
    ...(anonymous ? { 'Access-Control-Allow-Origin': '*' } : {}),
  };
  const held = matchingTag(request.headers.get('if-none-match'), answer.etag);
  if (held) return new Response(null, { status: 304, headers });
  return new Response(answer.css, { status: 200, headers: { ...headers, 'Content-Type': 'text/css; charset=utf-8' } });
}

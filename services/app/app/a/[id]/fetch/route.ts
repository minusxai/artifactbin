/**
 * GET /a/:id/fetch?url=<https url> — A DOCUMENT'S SCRIPT REACHES ANOTHER HOST THROUGH US.
 *
 * A document on its own origin (APP__PAGES_HOST) may connect to its own doors and the module CDNs, and
 * nowhere else (lib/compiled-page/styles/document-csp): its reader's address never leaves for a host the reader
 * did not choose. A host the document DECLARES (`<meta name="csp-connect">` in this version's Helmet,
 * lib/document/csp-extensions) and this reader TRUSTS (they published it, or allowed it on the consent
 * bar: lib/trust/document-trust `cspExtensionsFor`) is reached here instead, by this server, under the open-web fetch guard every other server-side URL fetch uses
 * (lib/web-ingest): https only, no private, loopback or link-local address at any hop, redirects pinned
 * to the declared host, one 10 s deadline, a 5 MB cap. GET only, no cookie or credential forwarded,
 * the answer's content type kept and the bytes inert (`sandbox`, `nosniff`, never cached).
 *
 * The same read ACL as the page: a reader who may not read the document gets the uniform 404. Counted
 * per document and reader, like the document's other outbound fetching (lib/accounts/auth).
 */
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { refusingUnservable } from '@/lib/artifacts/servable';
import { documentFetchRateLimited, requestOrSessionActor } from '@/lib/accounts';
import { json } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { fetchWebResource, webIngestAllowsHttp } from '@/lib/web-ingest/fetch';
import { servedRow } from '@/lib/serving';
import { pagesRequestOf } from '@/lib/http/pages-origin';
import { cspExtensionsFor, declaredCspExtensions } from '@/lib/trust/document-trust';
import { cspOriginMatches } from '@/lib/document/csp-extensions';
import { WebIngestError } from '@/lib/web-ingest/guard';

/** The answer cap: what a script may pull through us in one call. */
export const DOCUMENT_FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_FETCH_TIMEOUT_MS = 10_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

/** Does a connect set admit `target`? A declared https origin also admits its http twin where plain http is fetchable (development). */
function admits(set: readonly string[], target: URL): boolean {
  const origins = [target.origin, ...(target.protocol === 'http:' && webIngestAllowsHttp() ? [`https://${target.host}`] : [])];
  return origins.some((origin) => set.some((declared) => cspOriginMatches(declared, origin)));
}

const refusedStatus = (error: WebIngestError): number => {
  switch (error.code) {
    case 'invalid_url': return 400;
    case 'forbidden_scheme': case 'forbidden_host': case 'forbidden_address': return 403;
    case 'too_large': return 502;
    case 'timeout': return 504;
    default: return 502;
  }
};

export function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return refusingUnservable(() => fetchForDocument(request, ctx), NO_STORE);
}

async function fetchForDocument(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404, NO_STORE);
  const artifact = await getArtifactById(id);
  if (!artifact) return json({ error: 'not_found' }, 404, NO_STORE);
  const actor = await requestOrSessionActor(request);
  if (actor.tokenId !== artifact.token_id && !(await canReadArtifact(artifact, actor.viewer))) return json({ error: 'not_found' }, 404, NO_STORE);

  const raw = new URL(request.url).searchParams.get('url') ?? '';
  let target: URL;
  try { target = new URL(raw); } catch { return json({ error: 'invalid_url' }, 400, NO_STORE); }
  // This version's declared hosts, narrowed to the ones this reader trusts. On the document's own origin the reader's
  // "Allow once" grants arrive with the pages session (server/pages-host marks the request).
  const row = servedRow(artifact, null);
  if (!admits(declaredCspExtensions(row.source).connect, target)) {
    return json({ error: 'undeclared_host', detail: `this document does not declare ${target.origin}` }, 403, NO_STORE);
  }
  const pages = pagesRequestOf(request);
  const trusted = await cspExtensionsFor({
    artifact: row, viewer: { userId: actor.viewer?.userId ?? null, tokenId: actor.tokenId ?? null },
    // The app origin's session cookie never belongs to a document's own origin: there, only what was carried.
    ...(pages ? { carried: pages.carried ?? null } : { request }),
  });
  if (!admits(trusted.connect, target)) {
    return json({ error: 'host_not_allowed', detail: `this reader has not allowed this document to reach ${target.origin}` }, 403, NO_STORE);
  }
  const reader = actor.viewer?.userId ?? actor.tokenId ?? 'guest';
  if (documentFetchRateLimited(id, reader)) return json({ error: 'rate_limited' }, 429, { ...NO_STORE, 'Retry-After': '60' });

  try {
    const got = await fetchWebResource(target.href, {
      maxBytes: DOCUMENT_FETCH_MAX_BYTES, timeoutMs: DOCUMENT_FETCH_TIMEOUT_MS,
      // Every redirect hop stays on the declared host.
      allowHosts: (hostname) => hostname === target.hostname,
    });
    return new Response(new Uint8Array(got.bytes), { status: 200, headers: {
      ...NO_STORE,
      'Content-Type': got.contentType || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      // Inert if opened directly: whatever the bytes are, they never run on this origin.
      'Content-Security-Policy': "default-src 'none'; sandbox",
    } });
  } catch (error) {
    if (error instanceof WebIngestError) return json({ error: error.code, detail: error.message }, refusedStatus(error), NO_STORE);
    throw error;
  }
}

/** GET only: a script reads through us, it never writes. */
const notAllowed = (): Response => json({ error: 'method_not_allowed' }, 405, { ...NO_STORE, Allow: 'GET' });
export const POST = notAllowed;
export const PUT = notAllowed;
export const PATCH = notAllowed;
export const DELETE = notAllowed;

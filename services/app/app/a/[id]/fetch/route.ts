/**
 * GET /a/:id/fetch?url=<https url> — A DOCUMENT'S SCRIPT REACHES ANOTHER HOST THROUGH US.
 *
 * A document on its own origin (APP__PAGES_HOST) may connect to its own doors and the module CDNs, and
 * nowhere else (lib/story/styles/document-csp): its reader's address never leaves for a host the reader
 * did not choose. A host the document DECLARES (`meta.cspExtensions.connect`, brief C) is reached here
 * instead, by this server, under the open-web fetch guard every other server-side URL fetch uses
 * (lib/web-ingest): https only, no private, loopback or link-local address at any hop, redirects pinned
 * to the declared host, one 10 s deadline, a 5 MB cap. GET only, no cookie or credential forwarded,
 * the answer's content type kept and the bytes inert (`sandbox`, `nosniff`, never cached).
 *
 * The same read ACL as the page: a reader who may not read the document gets the uniform 404. Counted
 * per document and reader, like the document's other outbound fetching (lib/accounts/auth).
 */
import { canReadArtifact, getArtifactById } from '@/lib/artifacts';
import { documentFetchRateLimited, requestOrSessionActor } from '@/lib/accounts';
import { json } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { fetchWebResource } from '@/lib/web-ingest/fetch';
import { WebIngestError } from '@/lib/web-ingest/guard';

/** The answer cap: what a script may pull through us in one call. */
export const DOCUMENT_FETCH_MAX_BYTES = 5 * 1024 * 1024;
export const DOCUMENT_FETCH_TIMEOUT_MS = 10_000;
const NO_STORE = { 'Cache-Control': 'no-store' };

/** The https origins a document declares it connects to (brief C's `cspExtensions.connect`), exact origins only. */
export function declaredConnectOrigins(meta: unknown): string[] {
  const connect = (meta as { cspExtensions?: { connect?: unknown } } | null)?.cspExtensions?.connect;
  if (!Array.isArray(connect)) return [];
  return connect.flatMap((entry) => {
    if (typeof entry !== 'string') return [];
    try { const url = new URL(entry); return url.origin === entry ? [entry] : []; } catch { return []; }
  });
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

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return json({ error: 'not_found' }, 404, NO_STORE);
  const artifact = await getArtifactById(id);
  if (!artifact) return json({ error: 'not_found' }, 404, NO_STORE);
  const actor = await requestOrSessionActor(request);
  if (actor.tokenId !== artifact.token_id && !(await canReadArtifact(artifact, actor.viewer))) return json({ error: 'not_found' }, 404, NO_STORE);

  const raw = new URL(request.url).searchParams.get('url') ?? '';
  let target: URL;
  try { target = new URL(raw); } catch { return json({ error: 'invalid_url' }, 400, NO_STORE); }
  // TODO(brief C): replace the stored-meta read with this version's declared, consented hosts —
  // cspExtensionsFor({ artifact: { id, version, source }, viewer: { userId, tokenId }, request }).connect
  // from '@/lib/trust/document-trust' (derived from the version's source, narrowed by the reader's consent).
  if (!declaredConnectOrigins(artifact.meta).includes(target.origin)) {
    return json({ error: 'undeclared_host', detail: `this document does not declare ${target.origin}` }, 403, NO_STORE);
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

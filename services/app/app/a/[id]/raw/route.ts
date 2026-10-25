import {nativeHtmlPresentation} from '@/lib/serving/native-html-presentation.server';
import { archivedVersionFor, servedRow } from '@/lib/serving';
/**
 * GET /a/:id/raw — the artifact's own bytes (the standalone document for
 * markup, JSON/image bytes for the data tiers), a SUB-PATH of the one
 * shareable URL rather than a sibling top-level route.
 *
 * Why a route handler and not a query string on the page: the PATH selects the
 * handler before any query is read, and a page can neither return raw bytes nor
 * set the per-row response headers that the document's sandbox is built from.
 * `?raw=true` on a page could do neither.
 *
 * For the document THESE HEADERS ARE THE SANDBOX:
 * - `default-src 'none'` blocks the network except the document's own query
 *   endpoint (connect-src); frames are same-origin only;
 *   subresources only from our own origin or data:/blob: — documents must be
 *   self-contained.
 * - `sandbox allow-scripts` (no allow-same-origin) gives the document an
 *   opaque origin, so author JS cannot read the human UI's localStorage even
 *   though it is same-host. Verified live: reading localStorage throws.
 */
import { accessMoved, type ArtifactHeader, type ArtifactRow, canReadArtifact, getArtifactById, getArtifactHeaderById, refusingUnservable, VERSION_PARAM } from '@/lib/artifacts';
import { trackEvent, verifyExportKey } from '@/lib/platform';
import {storedCspExtensions} from '@/lib/document';
import {cspExtensionsFor} from '@/lib/trust/document-trust';
import { requestOrSessionActor } from '@/lib/accounts';
import { baseUrl, parseByteRange } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { loadDatasetRows } from '@/lib/datasets/dataset-store';
import { ObjectUnavailable } from '@/lib/object-store';
import { Readable } from 'node:stream';
import { loadImage } from '@/lib/object-store/image-store';
import { serveStoredFile } from '@/lib/datasets/file-store';
import { loadPdfStream, pdfFilename, pdfMetaOf } from '@/lib/object-store/pdf-store';
import type { StorySurface } from '@/lib/story-runtime/story-fragment';
import { pagesRequestOf } from '@/lib/http/pages-origin';
import { catalogOf,publicCatalogOf } from '@/lib/datasets/catalog';
import { servesDocument } from '@/lib/serving';
import { matchingTag, notModified, REVALIDATE } from '@/lib/http/revalidation';
import { nativeHtmlDocument, nativeHtmlPolicy, nativeHtmlRuntimeIdentity } from '@/lib/serving/native-html.server';
import { etagOf } from '@/lib/http/revalidation';

// The markup document's policy — per document, built in lib/page-styles/markup-csp:
// content-independent except for the ONE connect-src that admits exactly this
// document's own query endpoint (the top-level reader's transport).

const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const NOT_FOUND = '<!doctype html><meta charset="utf-8"><title>Not found</title><h1>Not found</h1>';

/**
 * A POST ON ITS OWNER'S CUSTOM DOMAIN (server/custom-host). Only the host
 * boundary sets it — the router passes params alone — so no request can ask
 * for this mode. It renders the reader copy with no reader chrome and no doors,
 * a footer back to the app, and a self-canonical on the domain; every
 * capture, archive and editing switch on the URL is ignored.
 */
interface DomainPost { hostname: string; ownerId: string; homepage?: boolean; path?: string }

const notFound = () =>
  new Response(NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', ...COMMON } });


/**
 * THE STORY FRAGMENT (`GET /a/:id/story`, app/a/[id]/story): the compiled document's newest version as
 * the page that asks is served it, for the live morph (lib/islands/morph/engine) — `raw`, this route's
 * own reader copy, or `app`, the app page's story (its isolated sheet, its inline drawings). Only the
 * route sets it (the router passes params alone), so no request can ask for it here. Same admission,
 * same compiled inputs, same sandbox; never a view, never a fallback renderer (a fallback is an answer the
 * page reloads on), and readable from the `/raw` copy's opaque origin by an anonymous reader.
 */
interface StoryFragmentRequest { surface: StorySurface }

/** A stored shape the current code no longer serves answers its 410 (lib/artifacts/servable), after the ACL below. */
export function GET(request: Request, ctx: { params: Promise<{ id: string }>; domain?: DomainPost; fragment?: StoryFragmentRequest }): Promise<Response> {
  return refusingUnservable(() => serveRaw(request, ctx));
}

async function serveRaw(request: Request, ctx: { params: Promise<{ id: string }>; domain?: DomainPost; fragment?: StoryFragmentRequest }): Promise<Response> {
  const { id } = await ctx.params;
  const domain = ctx.domain ?? null;
  // The document's own origin (APP__PAGES_HOST): server/pages-host marked this request when it routed it here.
  const pages = domain ? null : pagesRequestOf(request);
  if (pages && pages.id !== id) return notFound();
  const fragment = domain ? null : ctx.fragment ?? null;
  if (!ID_RE.test(id)) return notFound();
  const key = domain ? null : new URL(request.url).searchParams.get('key');
  /*
   * A REVALIDATION is decided on the row's HEADER: a document on its own origin asked with a validator, and nothing that is
   * never revalidated (a key, a fragment, a version). It is admitted, and answered 304 below, without the database
   * reading or sending the document (megabytes of JSONB for a large page); only a miss reads the row whole after it.
   * Every other request reads the row whole once, as its answer has a body.
   */
  const asked = request.headers.get('if-none-match');
  const conditional = !!pages && !key && !fragment && !!asked && !new URL(request.url).searchParams.has(VERSION_PARAM);
  const metadataOnly = conditional || (request.method === 'HEAD' && !key && !new URL(request.url).searchParams.has(VERSION_PARAM));
  const loaded = metadataOnly ? null : await getArtifactById(id);
  const header: ArtifactHeader | null = loaded ?? (metadataOnly ? await getArtifactHeaderById(id) : null);
  if (!header) return notFound();
  if (fragment) return notFound();
  if (domain && !servesDocument(domain.ownerId, header)) return notFound();
  /*
   * The ACL decides before any bytes leave; a denied private doc is
   * indistinguishable from a missing one.
   *
   * The exporter's signed key is the one way in without a session, and it must
   * be honoured HERE and not only on the page: the page is just the outside,
   * and the document arrives through a SEPARATE, credential-less request for
   * this route. Without it a private document exported as a 200 PNG *of a 404
   * page* — the shot succeeded, so nothing looked wrong.
   *
   * The key is scoped to one artifact and lives seconds (lib/export-key). It
   * admits a reader; it does not relax the sandbox, which is set below either
   * way.
   */
  // The SAME viewer the proxy and the page decide ownership with: sessionActor
  // uses the proxy-attached actor first, then direct compatibility and the
  // agent cookie. Resolving it any other way — the account session alone —
  // makes a claimed-token browser an owner in the shell and a stranger in its
  // own private document.
  // Bearer first, then the browser credentials, the same order as the export route, so the CLI
  // can fetch the page of an artifact its token owns or may read.
  const actor = await requestOrSessionActor(request);
  const byExportKey = verifyExportKey(header.id, key ?? undefined);
  const admits = async (row: ArtifactHeader) => actor.tokenId === row.token_id || (await canReadArtifact(row, actor)) || byExportKey;
  if (!(await admits(header))) return notFound();

  const base = pages?.site.app ?? baseUrl(request);
  // Declarations belong to each immutable version; current viewer grants remain dynamic.
  const policyFor=async(row:Pick<ArtifactRow,'id'|'version'|'meta'>)=>nativeHtmlPolicy(id,base,pages?{self:pages.self,app:pages.site.app}:undefined,await cspExtensionsFor({artifact:{id:row.id,version:row.version,declared:storedCspExtensions(row.meta.htmlCsp)},viewer:actor,request,carried:pages?.carried}));
  let policy=await policyFor(header);
  const revalidated = !!pages && !key && !new URL(request.url).searchParams.has(VERSION_PARAM);
  const validator = async (row: ArtifactHeader) => etagOf({
    id: row.id, version: row.version, edit: row.edit_id, updated: row.updated_at,
    // Source is immutable within a published version; bindings are header metadata.
    links: row.meta.htmlLinks ?? [], runtime: await nativeHtmlRuntimeIdentity(), policy, actor,
  });
  const responseHeaders = (etag: string | null) => ({
    ...COMMON, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy,
    // The per-render script nonce changes bytes, while these facts retain semantic identity.
    ...(etag ? { ETag: `W/${etag}`, 'Cache-Control': REVALIDATE } : {}),
  });
  if (header.format === 'html' && metadataOnly) {
    const etag = revalidated ? await validator(header) : null;
    const held = etag && matchingTag(asked, etag);
    if (held) return notModified(`W/${held}`);
    if (request.method === 'HEAD') return new Response(null, { headers: responseHeaders(etag) });
  }

  const artifact = loaded ?? await getArtifactById(id);
  if (!artifact) return notFound();
  // Admission is asked again of the row served when its access moved after the header was read.
  if (!loaded && accessMoved(header, artifact) && !(await admits(artifact))) return notFound();

  switch (artifact.format) {
    case 'html': {
      const at = domain ? null : await archivedVersionFor(request, artifact, { capture: byExportKey });
      if (at === 'not_found') return notFound();
      const row = { ...servedRow(artifact, at), version: at?.version ?? artifact.version };
      if(at)policy=await policyFor(row);
      const etag = revalidated && !at ? await validator(artifact) : null;
      const held = etag && matchingTag(asked, etag);
      if (held) return notModified(`W/${held}`);
      if (request.method === 'HEAD') return new Response(null, { headers: responseHeaders(etag) });
      const rendered = await nativeHtmlDocument({ row, ...(pages ? { appOrigin: pages.site.app } : {}) });
      if (!key && request.method !== 'HEAD') void trackEvent('view', artifact.id, { userId: actor.userId });
      return new Response(await nativeHtmlPresentation(rendered.html,row,domain), { headers: responseHeaders(etag) });
    }
    case 'file': return serveStoredFile(request, artifact);
    case 'dataset':
    {
      const catalog=catalogOf(artifact);
      const legacyFlat=catalog?.kind==='stored'&&catalog.tables.length===1&&catalog.tables[0].schema==='public'&&catalog.tables[0].name==='rows'&&typeof (artifact.meta as Record<string,unknown>).objectKey==='string';
      return new Response(JSON.stringify(legacyFlat||!catalog ? await loadDatasetRows(artifact) : {catalog:publicCatalogOf(artifact)}), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...COMMON },
      });
    }

    case 'viz':
      return new Response(artifact.source ?? '', {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...COMMON },
      });

    case 'image': {
      let img: Awaited<ReturnType<typeof loadImage>>;
      try {
        // `w=` is the width a `srcset` asked for — one of the widths publish
        // stored, never a resize (lib/object-store/image-store).
        img = await loadImage(artifact, { width: new URL(request.url).searchParams.get('w') });
      } catch (error) {
        // The row promises bytes the store will not give: corruption or broken
        // credentials, both page-the-operator events — said plainly, never a 500.
        if (error instanceof ObjectUnavailable) return new Response('asset unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
        throw error;
      }
      if (!img) return notFound();
      // A versioned URL (`?v=<n>`, how refData embeds an image) is genuinely
      // immutable — the version changes when the bytes do. A bare URL might be
      // replaced under the same id, so it only gets a short freshness window.
      const versioned = new URL(request.url).searchParams.has('v');
      const scope = artifact.visibility === 'public' ? 'public' : 'private';
      const cache = versioned ? `${scope}, max-age=31536000, immutable` : `${scope}, max-age=300`;
      // SVG is inert inside an <img>, but a DIRECT hit on /raw renders it as a
      // document where its scripts WOULD run — so lock it down like the html
      // tier's sandbox. Raster types need no CSP (they are not documents).
      const svgCsp: Record<string, string> = img.contentType === 'image/svg+xml'
        ? { 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" }
        : {};
      // `new Uint8Array(buffer)` re-homes the bytes on a fresh ArrayBuffer so
      // the type is a BodyInit (a bare Buffer widens to ArrayBufferLike, which
      // is not) — the same pattern as ./export.
      return new Response(new Uint8Array(img.body), {
        status: 200,
        headers: { ...COMMON, 'Content-Type': img.contentType, 'Cache-Control': cache, ...svgCsp },
      });
    }

    /*
     * THE PDF — inline, sandboxed, streamed, seekable.
     *
     * Every part of this shape was measured rather than chosen:
     *  - `inline` is what makes the browser's own viewer render this instead of
     *    downloading it. `attachment` was measured doing NOTHING when opened
     *    from inside a document's sandbox — no popup, no download — so it is
     *    the one disposition a <File> card must not be served under.
     *  - `Content-Security-Policy: sandbox` does not stop the viewer (measured
     *    headful: it rendered exactly as the bare inline response did) and puts
     *    the response at an OPAQUE origin, where localStorage and
     *    document.cookie both throw. That is what keeps a file any user can
     *    cause us to store from gaining this origin's privileges — the same
     *    posture /assets/<hash> and the served document already rely on.
     *  - the bytes are STREAMED, never read whole: one 25 MB read is its own
     *    size in RSS for the life of the response and would evict the object
     *    store's entire read cache (lib/object-store getStream).
     *  - `Accept-Ranges` plus a real 206, because a viewer opening a long
     *    document reads its cross-reference table from the END first and then
     *    seeks; without ranges it must download all of it before the first page.
     */
    case 'pdf': {
      const meta = pdfMetaOf(artifact);
      if (!meta) return notFound();
      const range = parseByteRange(request.headers.get('range'), meta.bytes);
      // Built fresh per response: @hono/node-server writes the computed
      // Content-Length back INTO this object, so a shared constant would
      // announce the first body's length for every later one.
      const versioned = new URL(request.url).searchParams.has('v');
      const scope = artifact.visibility === 'public' ? 'public' : 'private';
      const headers: Record<string, string> = {
        ...COMMON,
        'Content-Type': meta.contentType,
        'Content-Disposition': `inline; filename="${pdfFilename(artifact.title, artifact.id)}"`,
        'Content-Security-Policy': 'sandbox',
        'Accept-Ranges': 'bytes',
        // Same rule as an image: a versioned address is genuinely immutable,
        // a bare one only gets a short freshness window.
        'Cache-Control': versioned ? `${scope}, max-age=31536000, immutable` : `${scope}, max-age=300`,
      };
      if (range === 'unsatisfiable') {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${meta.bytes}` } });
      }
      const length = range ? range.end - range.start + 1 : meta.bytes;
      // HEAD: the same answer without the body, so a viewer can learn the size
      // and that ranges are served before it asks for one. No stream is opened.
      if (request.method === 'HEAD') {
        return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': String(meta.bytes) } });
      }
      let stream: Readable;
      try {
        stream = await loadPdfStream(meta, range ?? undefined);
      } catch (error) {
        // A row promising bytes the store will not give: corruption or broken
        // credentials, both page-the-operator events — said plainly, never a 500.
        if (error instanceof ObjectUnavailable) return new Response('asset unavailable', { status: 503, headers: { 'cache-control': 'no-store' } });
        throw error;
      }
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: range ? 206 : 200,
        headers: {
          ...headers,
          'Content-Length': String(length),
          ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${meta.bytes}` } : {}),
        },
      });
    }

    /*
     * Anything else is a row this deployment does not serve — a leftover from a
     * retired tier. It is not a case to support: it gets the SAME uniform 404
     * as an id that never existed, because that is what it is to us. The
     * default exists only so the handler cannot fall off its end and answer a
     * 500.
     */
    default:
      return notFound();
  }
}

/**
 * HEAD is GET with the body thrown away — a PDF viewer sends one before it
 * starts seeking, to learn the size and whether ranges are served.
 *
 * It runs the real handler rather than a second, shorter one: the ACL, the
 * headers and the 404 must be the same answer, and a parallel implementation of
 * "the same but no body" is exactly where those drift. The PDF case knows it is
 * a HEAD and never opens a stream; every other format pays for a body it then
 * discards — honest, and what a HEAD costs anywhere.
 */
export async function HEAD(request: Request, ctx: { params: Promise<{ id: string }>; domain?: DomainPost }) {
  const res = await GET(request, ctx);
  // Cancel rather than leak: an unread stream holds its file handle open.
  await res.body?.cancel().catch(() => {});
  return new Response(null, { status: res.status, headers: new Headers(res.headers) });
}

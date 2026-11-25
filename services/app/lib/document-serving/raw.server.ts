/**
 * GET /a/:id/raw — the artifact's own bytes (the standalone document for
 * markup, JSON/image bytes for the data tiers), a SUB-PATH of the one
 * shareable URL rather than a sibling top-level route (app/a/[id]/raw parses
 * the request and answers with this).
 *
 * For the document THESE HEADERS ARE THE SANDBOX:
 * - `default-src 'none'` blocks the network except the document's own query
 *   endpoint (connect-src); frames are same-origin only;
 *   subresources only from our own origin or data:/blob: — documents must be
 *   self-contained.
 * - `sandbox allow-scripts` (no allow-same-origin) gives the document an
 *   opaque origin, so author JS cannot read the human UI's localStorage even
 *   though it is same-host. Verified live: reading localStorage throws.
 *
 * Every Cache-Control it answers with is ./cache-control's.
 */
import {designSystemChoice} from '@/lib/html-systems';
import { LIVE_VERSION_HEADER } from '@/lib/html-runtime';
import { type ArtifactHeader, type ArtifactRow, refusingUnservable, VERSION_PARAM } from '@/lib/artifacts';
import { recordView } from '@/lib/analytics';
import {storedCspExtensions} from '@/lib/document';
import {cspExtensionsFor} from '@/lib/trust';
import { requestOrSessionActor } from '@/lib/authentication';
import { baseUrl, pagesRequestOf, etagOf, matchingTag, notModified } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { LIVE_DATASET_REFUSAL, serveInlinePdf, serveStoredFile } from '@/lib/datasets';
import { ObjectUnavailable, loadImage, pdfFilename, pdfMetaOf } from '@/lib/object-store';
import { NO_STORE, REVALIDATE, storedBytesCacheControl } from './cache-control';
import { nativeHtmlPresentation } from './native-html-presentation.server';
import { canonicalDocumentUrl } from '@/lib/user-pages';
import { anonymousReader, FRAME_TTL_MS, NONCE_PLACEHOLDER, renderCache, renderKey, withFreshNonce } from './render-cache';
import { nativeHtmlDocument, nativeHtmlPolicy, nativeHtmlRuntimeIdentity } from './native-html.server';
import { openDocument } from './open-document.server';

// The markup document's policy — per document, built in lib/page-styles/markup-csp:
// content-independent except for the ONE connect-src that admits exactly this
// document's own query endpoint (the top-level reader's transport).

const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': NO_STORE,
};

const NOT_FOUND = '<!doctype html><meta charset="utf-8"><title>Not found</title><h1>Not found</h1>';

/**
 * A POST ON ITS ANONYMOUS OWNER HOST (server/user-host). Only the host
 * boundary sets it — the router passes params alone — so no request can ask
 * for this mode. It renders the reader copy with no reader chrome and no doors,
 * a footer back to the app, and the app canonical; every
 * capture, archive and editing switch on the URL is ignored.
 */
export interface DomainPost { hostname: string; owner: import('@/lib/user-pages').UserPagesOwner }

const notFound = () =>
  new Response(NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', ...COMMON } });
/** The row promises bytes the store will not give: said plainly, never a 500, and never kept. */
const unavailable = () => new Response('asset unavailable', { status: 503, headers: { 'cache-control': NO_STORE } });


/**
 * THE STORY FRAGMENT (`GET /a/:id/story`, app/a/[id]/story): the compiled document's newest version as
 * the page that asks is served it, for the live morph (lib/islands/morph/engine) — `raw`, this route's
 * own reader copy, or `app`, the app page's story (its isolated sheet, its inline drawings). Only the
 * route sets it (the router passes params alone), so no request can ask for it here. Same admission,
 * same compiled inputs, same sandbox; never a view, never a fallback renderer (a fallback is an answer the
 * page reloads on), and readable from the `/raw` copy's opaque origin by an anonymous reader.
 */

/** What a request for `/a/:id/raw` asks: the document, and the mode only the router's callers can set. */
export interface RawDocumentRequest { id: string; domain?: DomainPost; fragment?: true }

/** A stored shape the current code no longer serves answers its 410 (lib/artifacts/servable), after the ACL below. */
export function serveRawDocument(request: Request, asked: RawDocumentRequest): Promise<Response> {
  return refusingUnservable(() => serveRaw(request, asked));
}

async function serveRaw(request: Request, ctx: RawDocumentRequest): Promise<Response> {
  const { id } = ctx;
  const domain = ctx.domain ?? null;
  // The document's own origin (APP__PAGES_HOST): server/pages-host marked this request when it routed it here.
  const pages = domain ? null : pagesRequestOf(request);
  if (pages && pages.id !== id) return notFound();
  const fragment = domain ? null : ctx.fragment ?? null;
  if (!ID_RE.test(id)) return notFound();
  // A frame can revalidate or reuse prepared bytes without reading the source.
  // Reader-specific admission and policy are still evaluated on every request.
  const search = new URL(request.url).searchParams;
  const key = domain ? null : search.get('key');
  const archived = search.has(VERSION_PARAM);
  const asked = request.headers.get('if-none-match');
  const actor = await requestOrSessionActor(request);
  const cacheable = request.method === 'GET' && !domain && !fragment && !key && !archived && !search.has('v')
    && (!!pages || anonymousReader(actor));
  /*
   * A reader's own browser keeps the document (`private, no-cache`) and revalidates it: on its own origin and on a
   * publishing host alike. Every access check below runs before any 304; a key or an archived version never revalidates.
   */
  const revalidated = (!!pages || !!domain) && !key && !archived;
  const metadataOnly = cacheable || (revalidated && !fragment && !!asked)
    || (request.method === 'HEAD' && !key && !archived);
  if (fragment) return notFound();
  const options = { surface: 'raw', actor, owner: domain?.owner } as const;
  const opened = await openDocument(request, id, { ...options, header: metadataOnly ? 'metadata' : 'row' });
  if (opened === 'not_found') return notFound();
  const { header, live, exporting: byExportKey } = opened;

  const base = pages?.site.app ?? baseUrl(request);
  /*
   * THE EXPORTER'S CAPTURE (lib/export photographs `raw?chrome=0&key=…` here): a top-level page in the opaque sandbox
   * with no app frame. Its SQL reads go straight to the page SQL door, read-only, carrying the capture key.
   * The door admits an opaque origin only as the requester that key names (lib/page-doors `opaqueSqlRead`).
   * The image shows what its requester may read, never a session's view, and lib/export stores it for that audience.
   * Its page's own published files are read the same way: this response names each own-door address with the key
   * (native-html `captureKey`), as the asset door admits it. Only this response carries it: a keyed request is never a
   * shared render, and nothing stored, cached or downloaded holds it.
   */
  const capture = byExportKey && !pages, directReads = !!domain || capture;
  // Declarations belong to each immutable version; current viewer grants remain dynamic.
  const policyFor=async(row:Pick<ArtifactRow,'id'|'version'|'meta'>)=>nativeHtmlPolicy(id,base,pages?{self:pages.self,app:pages.site.app}:undefined,await cspExtensionsFor({artifact:{id:row.id,version:row.version,declared:storedCspExtensions(row.meta.htmlCsp)},viewer:actor,request,carried:pages?.carried}),{domainReads:directReads});
  let policy=await policyFor(header);
  const validator = async (row: ArtifactHeader, at = live) => etagOf({
    id: row.id, version: row.version, edit: row.edit_id, updated: row.updated_at, live: at,
    // Source is immutable within a published version; bindings are header metadata.
    links: row.meta.htmlLinks ?? [], designSystem: designSystemChoice(row.meta), runtime: await nativeHtmlRuntimeIdentity(), policy, actor,
    // What presentation writes around the source (native-html-presentation): the head's title and description, the
    // canonical address (its owner's live handle and title path) and, on a publishing host, whose host it is.
    title: row.title, description: row.description, canonical: await canonicalDocumentUrl(row),
    domain: domain && { hostname: domain.hostname, owner: { kind: domain.owner.kind, id: domain.owner.id, handle: domain.owner.handle, folderId: domain.owner.folderId ?? null } },
  });
  const responseHeaders = (etag: string | null) => ({
    ...COMMON, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': policy,
    // The per-render script nonce changes bytes, while these facts retain semantic identity.
    ...(etag ? { ETag: `W/${etag}`, 'Cache-Control': REVALIDATE } : {}),
  });
  // Everything a shared render's bytes depend on: the row's version, edit and metadata, who frames it, its policy and the runtime.
  const frameKey = async (row: ArtifactHeader) => renderKey({
    kind: 'frame', base, self: pages?.self ?? null, app: pages?.site.app ?? null, search: new URL(request.url).search,
    id: row.id, version: row.version, edit: row.edit_id, updated: row.updated_at, title: row.title, description: row.description, meta: row.meta,
    live, policy, runtime: await nativeHtmlRuntimeIdentity(),
  });
  // An open page reading its own newest version (lib/html-runtime/live-morph) is the same view, not another. A 304 is a view.
  const counted = () => { if (!key && request.method !== 'HEAD' && !request.headers.has(LIVE_VERSION_HEADER)) void recordView(header.id, { userId: actor.userId }); };
  if (header.format === 'html' && metadataOnly) {
    const etag = revalidated ? await validator(header) : null;
    const held = etag && matchingTag(asked, etag);
    if (held) { counted(); return notModified(`W/${held}`); }
    if (request.method === 'HEAD') return new Response(null, { headers: responseHeaders(etag) });
    const hit = cacheable ? renderCache.get(await frameKey(header)) : undefined;
    if (hit) {
      counted();
      return new Response(withFreshNonce(new TextDecoder().decode(hit.body)), { headers: responseHeaders(etag) });
    }
  }

  const document = await openDocument(request, id, { ...options, opened });
  if (document === 'not_found') return notFound();
  const { artifact, row, at, page, dataset, sameHead } = document;

  switch (artifact.format) {
    case 'html': {
      const renderRow = at ? { ...row, version: at.version } : row;
      if (at || !sameHead) policy = await policyFor(renderRow);
      const etag = revalidated && !at ? await validator(artifact, page?.live) : null;
      const held = etag && matchingTag(asked, etag);
      if (held) { counted(); return notModified(`W/${held}`); }
      if (request.method === 'HEAD') return new Response(null, { headers: responseHeaders(etag) });
      // Retained only when the row rendered is the one the key was read from (it, or its live text, may have moved since).
      const retained = cacheable && !at && sameHead && page?.live === live ? await frameKey(header) : null;
      // The owner's design-system choice is page metadata, current for every version shown (not part of the source).
      const rendered = await nativeHtmlDocument({ row: renderRow, presentation: nativeHtmlPresentation(renderRow, domain), designSystem: designSystemChoice(artifact.meta), ...(page ? { live: page.live, unsavedIds: page.unsavedIds } : {}), ...(pages ? { appOrigin: pages.site.app } : {}), ...(directReads ? { domainReads: true } : {}), ...(capture && key ? { captureKey: key } : {}), ...(retained ? { platformScriptNonce: NONCE_PLACEHOLDER } : {}) });
      counted();
      const { html } = rendered;
      if (!retained) return new Response(html, { headers: responseHeaders(etag) });
      renderCache.set(retained, { status: 200, headers: [], body: new TextEncoder().encode(html) }, FRAME_TTL_MS);
      return new Response(withFreshNonce(html), { headers: responseHeaders(etag) });
    }
    case 'file': return serveStoredFile(request, artifact);
    case 'dataset':
    {
      // A live dataset's raw view is its connection's summary (never a secret): its rows stay in its database.
      const live = dataset?.connection;
      if(live)return new Response(JSON.stringify({connection:live,message:LIVE_DATASET_REFUSAL}),{headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
      return new Response(JSON.stringify({ catalog: dataset?.catalog }), {
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
        if (error instanceof ObjectUnavailable) return unavailable();
        throw error;
      }
      if (!img) return notFound();
      // A versioned URL (`?v=<n>`, how refData embeds an image) is genuinely
      // immutable — the version changes when the bytes do. A bare URL might be
      // replaced under the same id, so it only gets a short freshness window.
      const cache = storedBytesCacheControl(artifact, new URL(request.url).searchParams.has('v'));
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

    case 'pdf': {
      const meta = pdfMetaOf(artifact);
      if (!meta) return notFound();
      return serveInlinePdf(request, meta, `inline; filename="${pdfFilename(artifact.title, artifact.id)}"`, {
        cacheControl: storedBytesCacheControl(artifact, new URL(request.url).searchParams.has('v')),
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

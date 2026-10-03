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
 *   endpoint (connect-src) and the sanctioned <Video> frame hosts;
 *   subresources only from our own origin or data:/blob: — documents must be
 *   self-contained.
 * - `sandbox allow-scripts` (no allow-same-origin) gives the document an
 *   opaque origin, so author JS cannot read the human UI's localStorage even
 *   though it is same-host. Verified live: reading localStorage throws.
 */
import {agentDiscovery} from '@/lib/serving';
import { archivedReadOnly, archivedVersionFor, servedRow } from '@/lib/serving';
import { canReadArtifact, dataflowForRow, getArtifactById, linkRoleOf, type ArtifactRow } from '@/lib/artifacts';
import { withIntent, type Intent } from '@/lib/http';
import { count, has } from '@/lib/accounts';
import { countOpenAnnotations } from '@/lib/annotations';
import { roleFor, type RequestActor } from '@/lib/accounts';
import { canAnnotate, canEdit, roleBehindLogin } from '@/lib/artifacts';
import { forkedFromCredit } from '@/lib/story/reader/fork-credit.server';
import { trackEvent } from '@/lib/platform';
import { requestOrSessionActor } from '@/lib/accounts';
import { verifyExportKey } from '@/lib/serving';
import { baseUrl, parseByteRange } from '@/lib/http';
import { ID_RE } from '@/lib/platform';
import { loadDatasetRows } from '@/lib/story/datasets/dataset-store';
import { ObjectUnavailable } from '@/lib/object-store';
import { Readable } from 'node:stream';
import { loadImage } from '@/lib/story/assets/image-store';
import { serveStoredFile } from '@/lib/story/assets/file-store';
import { loadPdfStream, pdfFilename, pdfMetaOf } from '@/lib/story/assets/pdf-store';
import { captureColor, engineRequested } from '@/lib/mermaid-images/store';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { declaresMutations } from '@/lib/story/document';
import { assetsPath, buildDocumentCsp, markupCsp, mutatePath, queryPath } from '@/lib/story/styles';
import { pagesRequestOf } from '@/lib/serving/pages-origin';
import { readUrlValues } from '@/lib/story/data';
import { getUserById } from '@/lib/accounts';
import { avatarUrl } from '@/lib/accounts';
import { displayTitle } from '@/lib/story/document';
import { CARD_RENDER_GENERATION } from '@/lib/serving';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';
import { catalogOf,publicCatalogOf } from '@/lib/datasets/catalog';
import { ASSETS_ORIGIN, PUBLIC_BASE_URL } from '@/lib/platform';
import { canonicalDocumentUrl, domainPostUrl, servesDocument } from '@/lib/serving';
import { READER_MODE_HEADER, VIEWER_OVERLAY_PATH } from '@/lib/compiled-page/contract';
import type { StorySurface } from '@/lib/compiled-page/story-fragment';
import { compiledPageFor, domainFooter } from '@/lib/compiled-page/serve.server';
import { preparedPageFor, recompilePage, reprepareStoredPage } from '@/lib/story/prepared/prepared-page.server';
import { documentStyleSheets } from '@/lib/story/styles';
import type { ReaderChromeInput } from '@/lib/story/reader';
import { readerChromeFonts } from '@/lib/story/styles';
import { cspExtensionsFor } from '@/lib/trust/document-trust';
import { appendCspExtensions } from '@/lib/trust/document-csp-stub';

// The markup document's policy — per document, built in lib/story/styles/markup-csp:
// content-independent except for the ONE connect-src that admits exactly this
// document's own query endpoint (the top-level reader's transport).

const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const NOT_FOUND = '<!doctype html><meta charset="utf-8"><title>Not found</title><h1>Not found</h1>';

/** Request-specific reader furniture around the compiled story. */
async function rawChrome(row: ArtifactRow, actor: RequestActor, at: { version: number; head: number } | null, ground: 'light' | 'dark'): Promise<ReaderChromeInput> {
  const viewerId = actor.viewer?.userId ?? null;
  const role = await roleFor(row, actor);
  const [creator, source, reader, likes, liked, follows, following, comments] = await Promise.all([
    row.user_id ? getUserById(row.user_id) : Promise.resolve(null),
    forkedFromCredit(row.forked_from),
    actor.credential === 'session' && viewerId ? getUserById(viewerId) : Promise.resolve(null),
    count('like', row.id),
    viewerId ? has(viewerId, 'like', row.id) : Promise.resolve(false),
    row.user_id && row.user_id !== viewerId ? count('follow', row.user_id) : Promise.resolve(0),
    viewerId && row.user_id && row.user_id !== viewerId ? has(viewerId, 'follow', row.user_id) : Promise.resolve(false),
    canAnnotate(role) ? countOpenAnnotations(row.id) : Promise.resolve(0),
  ]);
  const door = (intent: Intent) => viewerId
    ? `/a/${row.id}${withIntent('', intent)}`
    : `/login?callbackUrl=${encodeURIComponent(`/a/${row.id}${withIntent('', intent)}`)}`;
  const unlock = roleBehindLogin(linkRoleOf(row));
  return {
    artifactId: row.id, title: displayTitle(row), ground, visibility: row.visibility,
    author: creator ? { username: creator.username ?? null, id: creator.id, image: avatarUrl(creator), forkedFrom: source } : { username: null, forkedFrom: source },
    viewer: reader ? { id: reader.id, name: reader.username || reader.email || '', image: avatarUrl(reader) } : null,
    ownerBreadcrumb: role === 'owner' && !at, share: role === 'owner' && !at,
    archived: at ? { version: at.version, head: at.head } : null,
    edit: canEdit(role) && !at,
    reactions: at ? null : {
      like: { count: likes, liked, href: door('like') },
      follow: row.user_id && row.user_id !== viewerId ? { count: follows, following, href: door('follow') } : null,
      comment: { count: comments, href: door('comment') },
    },
    signIn: !at && !viewerId && (unlock === 'commenter' || unlock === 'editor')
      ? { unlocks: unlock, callbackUrl: `/a/${row.id}${withIntent('', 'comment')}` } : null,
    login: !viewerId ? { href: `/login?callbackUrl=${encodeURIComponent(`/a/${row.id}`)}` } : null,
    fork: at ? null : { href: door('fork') },
  };
}


/**
 * A POST ON ITS OWNER'S CUSTOM DOMAIN (server/custom-host). Only the host
 * boundary sets it — the router passes params alone — so no request can ask
 * for this mode. It renders the reader copy with no reader chrome and no doors,
 * a footer back to the app, and a self-canonical on the domain; every
 * capture, archive and editing switch on the URL is ignored.
 */
export interface DomainPost { hostname: string; ownerId: string }

const notFound = () =>
  new Response(NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', ...COMMON } });


/**
 * A POST ON ITS OWNER'S CUSTOM DOMAIN (server/custom-host). Only the host
 * boundary sets it — the router passes params alone — so no request can ask
 * for this mode. It renders the reader copy with no reader chrome and no doors,
 * a footer back to the app, and a self-canonical on the domain; every
 * capture, archive and editing switch on the URL is ignored.
 */
export interface DomainPost { hostname: string; ownerId: string }

/**
 * THE STORY FRAGMENT (`GET /a/:id/story`, app/a/[id]/story): the compiled document's newest version as
 * the page that asks is served it, for the live morph (lib/islands/morph/engine) — `raw`, this route's
 * own reader copy, or `app`, the app page's story (its isolated sheet, its inline drawings). Only the
 * route sets it (the router passes params alone), so no request can ask for it here. Same admission,
 * same compiled inputs, same sandbox; never a view, never a fallback renderer (a fallback is an answer the
 * page reloads on), and readable from the `/raw` copy's opaque origin by an anonymous reader.
 */
export interface StoryFragmentRequest { surface: StorySurface }

export async function GET(request: Request, ctx: { params: Promise<{ id: string }>; domain?: DomainPost; fragment?: StoryFragmentRequest }) {
  const { id } = await ctx.params;
  const domain = ctx.domain ?? null;
  // The document's own origin (APP__PAGES_HOST): server/pages-host marked this request when it routed it here.
  const pages = domain ? null : pagesRequestOf(request);
  if (pages && pages.id !== id) return notFound();
  const fragment = domain ? null : ctx.fragment ?? null;
  if (!ID_RE.test(id)) return notFound();
  const artifact = await getArtifactById(id);
  if (!artifact) return notFound();
  if (fragment && artifact.format !== 'markup') return notFound();
  if (domain && !servesDocument(domain.ownerId, artifact)) return notFound();
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
  const key = domain ? null : new URL(request.url).searchParams.get('key');
  // The SAME viewer the proxy and the page decide ownership with: sessionActor
  // uses the proxy-attached actor first, then direct compatibility and the
  // agent cookie. Resolving it any other way — the account session alone —
  // makes a claimed-token browser an owner in the shell and a stranger in its
  // own private document.
  // Bearer first, then the browser credentials, the same order as the export route, so the CLI
  // can fetch the page of an artifact its token owns or may read.
  const actor = await requestOrSessionActor(request);
  const viewer = actor.viewer;
  const byExportKey = verifyExportKey(artifact.id, key ?? undefined);
  const admitted = actor.tokenId === artifact.token_id || (await canReadArtifact(artifact, viewer)) || byExportKey;
  if (!admitted) return notFound();

  switch (artifact.format) {
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
        // stored, never a resize (lib/story/assets/image-store).
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
     * markup: the SSR'd standalone document, sandboxed by the headers above —
     * the document BY ITSELF, at its own address. The app page renders the same
     * document inline instead (server/app `withInitialStory`), so what reaches
     * here is an explicit request for the bytes and the export's own capture
     * (lib/export shoots `raw?chrome=0&key=`). Source read-back is the API's
     * `markup:`.
     *
     * A FOLDER IS NOT HERE. It has no content, so there is no document to
     * serve: its listing is app data the page endpoint answers and the app
     * server inlines. It falls to the `default` below and gets the SAME uniform
     * 404 an unknown id gets.
     */
    case 'markup': {
      /*
       * `?version=N` — THIS document as it was, read-only, for whoever may
       * read its history (lib/archived-version). Decided before anything is
       * read or rendered: a reader without history access, an invalid number
       * and a version that was never archived all get the SAME uniform 404 the
       * rest of this route answers, so nobody learns the parameter exists.
       */
      const at = domain ? null : await archivedVersionFor(request, artifact, { capture: byExportKey });
      if (at === 'not_found') return notFound();
      // Everything below renders THIS row: the artifact wearing that version's
      // bytes when one was asked for, the artifact itself otherwise. One
      // substitution rather than a conditional at every read.
      const row = await servedRow(artifact, at);
      /*
       * Explicit raw document reads still count here. Ordinary app readers
       * render inline and report through /api/page/artifact/:id/view instead;
       * they do not fetch this route. Both use the same daily visitor hash.
       *
       * Never for a capture: that is our own headless browser re-reading the
       * document to photograph it, not a reader. `void`, because analytics may
       * never delay or fail a render.
       */
      if (!key && !fragment && request.method !== 'HEAD') void trackEvent('view', artifact.id, { userId: viewer?.userId ?? null });

      const meta = row.meta as { theme?: StoryThemeName | null; template?: string | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null; cssCompileVersion?: string | null };
      // Stored rows may still carry a retired theme name (aliased forward) and
      // a sheet compiled under an older registry (recompiled) — both resolve
      // at the door so the served document always speaks the live vocabulary.
      // A CAPTURE may be drawn in either mode (lib/mermaid-images harvests both); a reader sees the author's.
      const design = resolveStoredStoryDesign(meta.theme, (byExportKey && !domain ? captureColor(request.url) : null) ?? meta.colorMode);
      const compiledCss = await currentStoryCss(meta, row.source);
      // ?chrome=0 — the capture path (lib/export screenshots this frame, so the
      // document's own rail/present bar and attribution footer would land in
      // every OG card).
      const chrome = domain ? true : new URL(request.url).searchParams.get('chrome') !== '0';
      // The app's own reader chrome, doors and agent pointers — never on a custom domain, and never on the
      // document's own origin, where the app page frames this copy and draws the chrome around it.
      const reader = chrome && !domain && !pages;
      // A signed capture is fetched over the exporter's internal transport.
      // A cohost HTTPS proxy can otherwise stamp https onto an HTTP backend,
      // breaking scoped asset imports and the capture's CSP before rendering.
      // On the document's own origin the app's addresses (its card, its canonical) are the app origin's.
      const base = pages ? pages.site.app : byExportKey && !chrome ? new URL(request.url).origin : baseUrl(request);
      // Every admitted document read is compiled, including live story fragments.
      /** The app page's story (lib/artifact-page) differs from this copy in its sheet and its drawings, never in its story. */
      const appStory = fragment?.surface === 'app';
      {
        const capture = byExportKey && !chrome;
        let prepared = await preparedPageFor(artifact, at, base);
        if (byExportKey && request.headers.get('x-mx-compiled-backfill') === 'recompile') {
          // A page prepared under an older stylesheet is prepared again whole (its compile with it); otherwise only recompiled.
          if (prepared.stale) prepared = await reprepareStoredPage(artifact, at, base);
          else {
            const compiled = await recompilePage(prepared.row, at, prepared.page);
            if (compiled) prepared.page.compiled = compiled;
          }
        }
        const flow = prepared.page.declared?.flow ?? null;
        // The exporter photographs this page: its run is settled, and carries whoever asked (see the
        // capture's run below) — never the guest snapshot's rows, never cached.
        const ran = capture && flow && !prepared.page.declared?.state
          ? await dataflowForRow(row, { values: readUrlValues(new URL(request.url).search, flow), viewer: { userId: viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: viewer?.email ?? null } })
          : null;
        const answer = await compiledPageFor(prepared.row, prepared.page, {
          at,
          search: new URL(request.url).search,
          drawings: domain || engineRequested(request.url) ? null : appStory ? 'inline' : 'document',
          colorMode: byExportKey && !domain ? captureColor(request.url) : null,
          // On its own origin the copy carries its reader's pages session, an account's or a guest owner's.
          signedIn: pages ? actor.credential !== 'none' : actor.credential === 'session' && !!viewer?.userId,
          // A sandboxed copy's doors carry no credential (its origin is opaque): it holds what anyone may, as /raw always has.
          // On its own origin its doors answer for its pages session's reader, so the page holds what they may.
          holder: pages ? { userId: viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: viewer?.email ?? null } : null,
          // A capture's rows are settled, but its managed iframe still needs the scoped asset door.
          doors: capture ? { queryUrl: '', assetsUrl: `${assetsPath(artifact.id)}?key=${encodeURIComponent(key!)}` } : pages ? {
            // Its own origin's doors, absolute, called directly with the pages cookie (server/pages-host).
            queryUrl: `${pages.self}${queryPath(artifact.id)}`,
            ...(!at && declaresMutations(row.source) ? { mutateUrl: `${pages.self}${mutatePath(artifact.id)}` } : {}),
            viewerUrl: `${pages.self}${VIEWER_OVERLAY_PATH(artifact.id)}`,
            assetsUrl: `${pages.self}${assetsPath(artifact.id)}`,
            direct: true,
          } : {
            queryUrl: queryPath(artifact.id),
            ...(!at && declaresMutations(row.source) ? { mutateUrl: mutatePath(artifact.id) } : {}),
            viewerUrl: VIEWER_OVERLAY_PATH(artifact.id),
            assetsUrl: assetsPath(artifact.id),
          },
          ...(capture ? { assetsUrl: `${assetsPath(artifact.id)}?key=${encodeURIComponent(key!)}` } : {}),
          ...(at ? { readOnly: archivedReadOnly(at.version) } : {}),
          live: chrome && !at ? { id: artifact.id, editId: artifact.edit_id, ...(pages ? { direct: true } : {}) } : null,
          // The one app origin that frames this copy, for the frame side of the app bridge (brief B).
          ...(pages ? { appOrigin: pages.site.app } : {}),
          chrome: reader && !fragment ? await rawChrome(artifact, actor, at, design.colorMode ?? prepared.page.data.colorMode) : null,
          chromeFonts: reader && !fragment ? readerChromeFonts({ theme: prepared.page.base.theme, docFonts: prepared.page.base.fonts, importedFaces: prepared.page.base.faces }).map((face) => face.url) : [],
          spa: null,
          // The page's own behaviour (lib/islands/page): framing, the reader's colour override, the live
          // stream of a page with no islands, the scroll a live reload keeps. Never on a capture.
          behaviors: capture ? [] : ['page'],
          // `chrome=0` draws the document without its own chrome (a deck's rail and present bar).
          documentChrome: chrome,
          capture: !chrome,
          head: chrome
            ? {
              description: row.description,
              canonical: domain ? domainPostUrl(domain.hostname, artifact) : await canonicalDocumentUrl(artifact),
              social: { title: displayTitle(row), description: row.description, image: `${domain ? PUBLIC_BASE_URL.replace(/\/+$/, '') : base}/a/${artifact.id}/export?mode=card&v=${artifact.version}&r=${CARD_RENDER_GENERATION}` },
              help: reader ? agentDiscovery(base) : null,
            }
            : null,
          ...(ran ? { results: { tables: ran.state.tables, errors: ran.state.errors, ...(ran.state.userOptions ? { userOptions: ran.state.userOptions, people: ran.state.people ?? {} } : {}) } } : {}),
          // Its style rides in the sheets, where the standalone document has it.
          footer: domain ? { html: domainFooter(`${PUBLIC_BASE_URL.replace(/\/+$/, '')}/a/${artifact.id}`).html, css: '' } : null,
          // The standalone document's stylesheets, byte for byte (lib/story/styles/document-styles); the app
          // page's story carries its one isolated sheet instead (the assembler's `css`).
          sheets: appStory ? null : documentStyleSheets({
            compiledCss, chrome, bare: !!domain, theme: design.theme,
            importedFaces: prepared.page.base.faces, docFonts: prepared.page.base.fonts, authorCss: prepared.page.authorCss,
          }),
        });
        if (answer.mode === 'compiled') {
          // What this reader trusts the document to reach beyond the default policy (its Helmet
          // `csp-*` metas): the owner's own, or a reader's grant; nothing for anyone else, a capture included.
          // TODO(brief A): buildDocumentCsp({ self, extensions }) replaces markupCsp + appendCspExtensions here.
          const extensions = capture ? undefined : await cspExtensionsFor({ artifact: row, viewer: { userId: viewer?.userId ?? null, tokenId: actor.tokenId }, request });
          return new Response(answer.html, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              // On its own origin the document needs no sandbox: the origin is its alone (lib/story/styles/document-csp).
              'Content-Security-Policy': pages
                // TODO(brief C): extensions: cspExtensionsFor({ artifact: { id, version, source } of `row`, viewer: { userId: viewer?.userId ?? null, tokenId: actor.tokenId }, request })
                // from '@/lib/trust/document-trust' (its "Allow once" grant arrives as `pages.carried`).
                ? buildDocumentCsp({ self: pages.self, app: pages.site.app, id: artifact.id, assetOrigin: ASSETS_ORIGIN })
                : appendCspExtensions(markupCsp(base, artifact.id, ASSETS_ORIGIN ?? undefined, { compiled: true }), extensions),
              ...answer.headers,
              [READER_MODE_HEADER]: 'compiled',
              // The /raw copy asks from an opaque origin; an anonymous answer is what anyone with the link reads.
              ...(fragment && !actor.viewer && !actor.tokenId ? { 'Access-Control-Allow-Origin': '*' } : {}),
              ...COMMON,
            },
          });
        }
        // No renderer is left to answer: a reported 500.
        return new Response('<!doctype html><meta charset="utf-8"><title>Unavailable</title><h1>This document could not be rendered</h1>', {
          status: answer.status,
          headers: { 'Content-Type': 'text/html; charset=utf-8', [READER_MODE_HEADER]: 'compiled', ...COMMON },
        });
      }
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

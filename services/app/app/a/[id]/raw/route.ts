/**
 * GET /a/:id/raw — the artifact's own bytes (the standalone document for
 * markup, JSON/image bytes for the data tiers), a SUB-PATH of the one
 * shareable URL rather than a sibling top-level route.
 *
 * Why a route handler and not a query string on the page: in the App Router
 * the PATH selects the handler before any query is read, and a page can
 * neither return raw bytes nor set the per-row response headers that the
 * document's sandbox is built from. `?raw=true` on a page could do neither.
 *
 * For the document THESE HEADERS ARE THE SANDBOX:
 * - `default-src 'none'` blocks the network except the document's own query
 *   endpoint (connect-src) and the sanctioned <Video> frame hosts;
 *   subresources only from our own origin or data:/blob: — documents must be
 *   self-contained.
 * - `sandbox allow-scripts` (no allow-same-origin) gives the document an
 *   opaque origin, so author JS cannot read the human UI's localStorage even
 *   though it is same-host. Verified live: reading localStorage throws.
 * Keep the repo middleware-free so nothing rewrites them.
 */
import { canReadArtifact, dataflowForRow, declarationsForRow, getArtifactById, linkRoleOf, refDataForRow } from '@/lib/artifacts';
import { withIntent } from '@/lib/intent';
import { canonicalArtifactPath } from '@/lib/urls';
import { roleBehindLogin } from '@/lib/share-roles';
import { trackEvent } from '@/lib/analytics';
import { sessionActor } from '@/lib/viewer';
import { verifyExportKey } from '@/lib/export-key';
import { baseUrl, parseByteRange } from '@/lib/http';
import { ID_RE } from '@/lib/ids';
import { loadDatasetRows } from '@/lib/story/dataset-store';
import { ObjectUnavailable } from '@/lib/object-store';
import { Readable } from 'node:stream';
import { loadImage } from '@/lib/story/image-store';
import { loadPdfStream, pdfFilename, pdfMetaOf } from '@/lib/story/pdf-store';
import { webAssetsForSource } from '@/lib/web-assets';
import { buildStoryDocument } from '@/lib/story/document';
import { resolveStoredStoryDesign } from '@/lib/data/story/story-themes';
import { currentStoryCss } from '@/lib/data/story/story-css.server';
import { declaresMutations } from '@/lib/story/helmet';
import { assetsPath, markupCsp, mutatePath, queryPath } from '@/lib/story/markup-csp';
import { readUrlValues } from '@/lib/story/url-values';
import { storyRuntimeAssets } from '@/lib/story/runtime-asset';
import { ownerUsername } from '@/lib/users';
import { displayTitle } from '@/lib/story/title';
import { CARD_RENDER_GENERATION } from '@/lib/export-card';
import type { StoryThemeName } from '@/lib/validation/atlas-schemas';

// The markup document's policy — per document, built in lib/story/markup-csp:
// content-independent except for the ONE connect-src that admits exactly this
// document's own query endpoint (the top-level reader's transport).

const COMMON = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

const NOT_FOUND = '<!doctype html><meta charset="utf-8"><title>Not found</title><h1>Not found</h1>';
const notFound = () =>
  new Response(NOT_FOUND, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', ...COMMON } });

/**
 * WHERE THIS COPY CAME FROM, as the credit line may say it.
 *
 * The test is VISIBILITY — `public`, exactly — and deliberately NOT "may a
 * stranger read it". `unlisted` is stranger-readable, which is the whole tier,
 * but it exists to be listed NOWHERE: naming it here republishes its canonical
 * address in the credits of every public fork, and the person who forked is not
 * the person who chose the tier. Measured before this rule existed: an owner
 * who narrowed a source to `unlisted` after someone forked it kept handing the
 * full linked address to every stranger reading the copy.
 *
 * So there is ONE branch, and everything that is not public takes it —
 * unlisted, private, and gone alike, with no link and no id. That is also what
 * keeps the line from being an existence oracle: a reader has nothing here to
 * tell those three apart with.
 *
 * Resolved per render rather than per viewer, and never written into the
 * markup: an agent that rewrites the document cannot delete the attribution,
 * and nothing about the source is baked into bytes that outlive its ACL.
 */
const NOT_PUBLIC_SOURCE = { label: 'a document that is not public', href: null } as const;

async function forkedFromCredit(sourceId: string | null): Promise<{ label: string; href: string | null } | null> {
  if (!sourceId) return null;
  const source = await getArtifactById(sourceId);
  if (!source || source.visibility !== 'public') return NOT_PUBLIC_SOURCE;
  const href = canonicalArtifactPath(source, await ownerUsername(source.user_id));
  return { label: href.replace(/^\//, ''), href };
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!ID_RE.test(id)) return notFound();
  const artifact = await getArtifactById(id);
  if (!artifact) return notFound();
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
  const key = new URL(request.url).searchParams.get('key');
  // The SAME viewer the proxy and the page decide ownership with (sessionActor:
  // NextAuth first, then the agent cookie). Anything narrower splits the
  // document from its shell — a signed-out browser whose cookie names a
  // CLAIMED token would be an owner upstairs and a stranger here, its own
  // private document 404ing inside the frame the shell just rendered.
  const actor = await sessionActor(request);
  const viewer = actor.viewer;
  const byExportKey = verifyExportKey(artifact.id, key ?? undefined);
  const admitted = (await canReadArtifact(artifact, viewer)) || byExportKey;
  if (!admitted) return notFound();

  switch (artifact.format) {
    case 'dataset':
      return new Response(JSON.stringify(await loadDatasetRows(artifact)), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...COMMON },
      });

    case 'viz':
      return new Response(artifact.content, {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...COMMON },
      });

    case 'image': {
      let img: Awaited<ReturnType<typeof loadImage>>;
      try {
        // `w=` is the width a `srcset` asked for — one of the widths publish
        // stored, never a resize (lib/story/image-store).
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
     * The shape is the spike's recommendation (S4), and every part of it was
     * measured rather than chosen:
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
     * markup: the SSR'd standalone document — served top-level to readers
     * (proxy.ts) and as the owner frame's src. Source read-back is the API's
     * `markup:`.
     *
     * A FOLDER IS NOT HERE. It has no content, so there is no document to
     * serve: its listing is app data the page endpoint answers and the app
     * server inlines. It falls to the `default` below and gets the SAME uniform
     * 404 an unknown id gets — which is also what keeps `/a/<folder>` on the
     * app page for everybody (server/app `servesDocumentDirectly` would
     * otherwise hand a reader a 404 at the address they were given).
     */
    case 'markup': {
      /*
       * A view is counted HERE, not on the page.
       *
       * A reader is served this route directly (proxy.ts rewrites their
       * request to it), so the page's counter would miss every reader — which
       * is nearly all of them. This is also the more honest place: /raw is
       * fetched exactly once per view, whether the document arrives top-level
       * or inside the owner's frame, so there is no double count either.
       *
       * Never for a capture: that is our own headless browser re-reading the
       * document to photograph it, not a reader. `void`, because analytics may
       * never delay or fail a render.
       */
      if (!key && request.method !== 'HEAD') void trackEvent('view', artifact.id, { userId: viewer?.userId ?? null });

      const meta = artifact.meta as { theme?: StoryThemeName | null; template?: string | null; colorMode?: 'light' | 'dark' | null; compiledCss?: string | null; cssCompileVersion?: string | null };
      // Stored rows may still carry a retired theme name (aliased forward) and
      // a sheet compiled under an older registry (recompiled) — both resolve
      // at the door so the served document always speaks the live vocabulary.
      const design = resolveStoredStoryDesign(meta.theme, meta.colorMode);
      const compiledCss = await currentStoryCss(meta, artifact.source);
      // ?chrome=0 — the capture path (lib/export screenshots this frame, so the
      // document's own rail/present bar and attribution footer would land in
      // every OG card).
      const chrome = new URL(request.url).searchParams.get('chrome') !== '0';
      const base = baseUrl(request);
      /*
       * ?edit=1 — the OWNER's copy. In-place editing is the runtime, and a
       * document of pure prose ships none; asking for it here means pressing
       * edit costs one message instead of a reload. Grants nothing: the read
       * ACL above has already decided who may see this at all.
       */
      const editable = new URL(request.url).searchParams.get('edit') === '1';
      /*
       * ?comment=1 — a COMMENTER's copy. Commenting happens in the frame (only
       * the document can see a Selection at an opaque origin) but needs no
       * editor, and asking for `edit` bought one: the whole hydration runtime,
       * on a page of prose, to draw a tint. Grants nothing either — the read
       * ACL above has already decided who may see this at all.
       */
      const commenting = new URL(request.url).searchParams.get('comment') === '1';
      // `none` whenever the link grants no more than a guest already has, which
      // is every ordinary public document — see lib/share-roles roleBehindLogin.
      const behindLogin = roleBehindLogin(linkRoleOf(artifact));
      const signInUnlocks = behindLogin === 'commenter' || behindLogin === 'editor' ? behindLogin : null;
      /*
       * PAINT FIRST. A reader gets the DECLARATIONS and no rows: the document
       * arrives at final geometry immediately and fetches its own data through
       * the queryUrl its island names. Running the SQL here was ~90ms of a
       * ~100ms render and 231 KB of a 365 KB page on a real dashboard, all of
       * it spent before the reader could see anything.
       *
       * The capture render (`chrome=0`) is the one that must still be settled
       * rather than fast — /export photographs this frame, and a photograph of
       * a skeleton previews nothing.
       */
      /*
       * THE READER'S OWN SELECTION, carried in the link (`?$region=west` —
       * lib/story/url-values). It is read from the DECLARATIONS, which the
       * reader path needs anyway, so a link naming a value the document does
       * not declare, or a value its type refuses, costs nothing and changes
       * nothing: the document falls back to what its author declared. The
       * server's own keys on this URL (`key`, `chrome`, `edit`, `comment`,
       * `v`) carry no `$` and a Value can never be named with one, so a
       * selection cannot shadow them.
       *
       * Where it goes differs by which render this is, and that is the whole
       * of it:
       *  - the READER (chrome=1) gets the values on the island's THIRD
       *    dataflow field, values with no rows. Seeding through `state`
       *    instead would say "somebody already ran the queries" and cancel
       *    paint-first's first run, leaving every chart on its skeleton.
       *  - the CAPTURE (chrome=0) is the render that must be SETTLED rather
       *    than fast — /export photographs it — so its selection is threaded
       *    into the run itself and the rows it carries are the selected ones.
       */
      const declared = declarationsForRow(artifact);
      const search = new URL(request.url).search;
      const urlValues = declared ? readUrlValues(search, declared.flow) : {};
      const hasUrlValues = Object.keys(urlValues).length > 0;
      const [assetUrls, refData, dataflow, creatorUsername, forkedFrom] = await Promise.all([
        // Our copies of the web URLs this document names (lib/web-assets): the
        // served <img> points at them, with the box and the blur the row
        // recorded, and the reader's browser reaches no third party.
        webAssetsForSource(artifact.source),
        // A capture takes the full copy of every image: /export photographs
        // this frame, and a `sizes` hint against a headless viewport is how an
        // og card ends up showing the 640px one.
        refDataForRow(artifact, { capture: !chrome }),
        chrome
          ? Promise.resolve(declared && hasUrlValues ? { ...declared, values: urlValues } : declared)
          // The CAPTURE's run carries whoever asked for it, which matters for
          // any document reading a folder's children (`ref_<folderId>` is a
          // per-viewer table). The TOKEN travels beside the account:
          // sessionActor answers an account session as a viewer and the agent
          // cookie as a bare token, and an unclaimed row is owned by its token
          // — the viewer alone would photograph a stranger's view of it.
          : dataflowForRow(artifact, { values: urlValues, viewer: { userId: viewer?.userId ?? null, tokenId: actor.tokenId ?? null, email: viewer?.email ?? null } }),
        chrome ? ownerUsername(artifact.user_id) : Promise.resolve(null),
        chrome ? forkedFromCredit(artifact.forked_from) : Promise.resolve(null),
      ]);
      const runtime = storyRuntimeAssets();
      const html = await buildStoryDocument({
        assetUrls,
        chrome,
        editable,
        commenting,
        // Unfurl cards, for the reader path where this document IS the page.
        // Never on a capture render: that is the exporter shooting this frame.
        social: chrome
          ? {
            title: displayTitle(artifact),
            description: artifact.description,
            // ABSOLUTE: this document IS the page a crawler fetches, and a
            // relative og:image is resolved by some scrapers against the page
            // URL and by others not at all. baseUrl reads the forwarding
            // headers, so behind the proxy this is the public origin — never
            // the container's.
            image: `${base}/a/${artifact.id}/export?mode=card&v=${artifact.version}&r=${CARD_RENDER_GENERATION}`,
          }
          : null,
    help: chrome ? { docs: `${base}/docs`, tokens: `${base}/tokens/new` } : null,
        credits: chrome ? { creatorUsername, forkedFrom } : null,
        /*
         * THE WAY IN. A guest — no account, so ANONYMOUS_CEILING holds them at
         * `viewer` — on a link its owner set to `can comment` or `can edit` is
         * someone who has been invited and not told. The decision is the
         * route's because only here are the viewer and the row both in hand;
         * lib/story/document is handed the verdict and says it.
         *
         * Not a widening: this changes no ACL and buys no runtime. After they
         * sign in, effectiveRole finds the link role by itself and the shell
         * follows (server/app servesDocumentDirectly) — the path a signed-in
         * stranger has always taken.
         */
        signIn: chrome && !viewer && signInUnlocks
          // Back to the document AND back to what the door offered: someone who
          // logged in to comment returns to an open conversation rather than to
          // a document that has forgotten why they left (lib/intent).
          ? { unlocks: signInUnlocks, callbackUrl: `/a/${artifact.id}${withIntent('', 'comment')}` }
          : null,
        /*
         * FORK — on every chrome-bearing markup document, because a reader may
         * fork anything they can READ and the door decides on exactly that.
         *
         * The two hrefs differ by one thing: whether this request had a viewer.
         * With one, the shell is a navigation away and can be told what to do
         * on arrival; without one, the shell is behind /login, so the ask rides
         * through the login door and comes back on the other side. Either way
         * the document only carries the ASK — it is sandboxed at an opaque
         * origin and holds no session, so it could not POST the fork itself.
         */
        fork: chrome ? { href: viewer ? `/a/${artifact.id}${withIntent('', 'fork')}` : `/login?callbackUrl=${encodeURIComponent(`/a/${artifact.id}${withIntent('', 'fork')}`)}` } : null,
        source: artifact.source ?? '',
        compiledCss,
        theme: design.theme,
        template: meta.template ?? null,
        colorMode: design.colorMode,
        refData,
        dataflow,
        title: artifact.title,
        // Content-addressed, from the build's own manifest: the URL has to
        // change when the bytes do, because services/app/server/app.ts caches everything
        // under /story/ for a year. Null when there is no build — a document
        // that does not hydrate still reads (lib/story/runtime-asset).
        runtimeSrc: runtime.entry,
        anchorSrc: runtime.anchor,
        commentSrc: runtime.comment,
        lazyChunks: runtime.lazy,
        // Where this document fetches its re-runs when it IS the page (the
        // reader path); inside a parent the relay is chosen instead.
        queryUrl: queryPath(artifact.id),
        /*
         * …and where it imports an image URL only its reader can compute (a
         * bound <img src="$pick">). Unconditional, unlike mutateUrl: a source
         * can appear in the DOM without the document declaring it — an author
         * script, a table column — and the endpoint answers under this
         * document's own read ACL either way.
         *
         * A CAPTURE carries the exporter's key in that address, because a
         * markup document is photographed from THIS page top-level (lib/export
         * — `raw?chrome=0&key=`), in a browser with no session and with no
         * parent to relay through: the address is the only thing left that can
         * present a credential, and without it a private document's og image
         * photographs its alt text. Only a key this route VERIFIED is echoed,
         * so nothing a caller invents ever reaches the document.
         */
        assetsUrl: byExportKey ? `${assetsPath(artifact.id)}?key=${encodeURIComponent(key!)}` : assetsPath(artifact.id),
        // Only a document that declares a write gets a write URL: a document
        // that cannot write should not carry the address of a door it never
        // opens.
        ...(declaresMutations(artifact.source) ? { mutateUrl: mutatePath(artifact.id) } : {}),
        // A capture gets none: it has no reader, and a document that adopted an
        // edit mid-shot would be photographed halfway between two versions.
        live: chrome ? { id: artifact.id, editId: artifact.edit_id } : null,
      });
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': markupCsp(base, artifact.id),
      ...(chrome ? { Link: `<${base}/docs>; rel="help"` } : {}),
          ...COMMON,
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
export async function HEAD(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const res = await GET(request, ctx);
  // Cancel rather than leak: an unread stream holds its file handle open.
  await res.body?.cancel().catch(() => {});
  return new Response(null, { status: res.status, headers: new Headers(res.headers) });
}

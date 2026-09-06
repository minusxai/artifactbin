/**
 * On-demand artifact → image rendering, the curlable screenshot path
 * (`GET /a/<id>/export`). There is no browserless way to rasterize arbitrary
 * HTML (Node SVG rasterizers ignore foreignObject; Satori is a flexbox subset
 * — minusx Story_Design_V2 §13), so a real browser takes the picture.
 *
 * THE BROWSER IS NOT THIS MODULE'S ANY MORE. Chromium — the singleton, the
 * serialising chain, the idle shutdown, and the capture modes — lives in
 * `@artifactbin/browser`, and this module reaches it through the services
 * registry (`lib/services`): an HTTP client when `BROWSER__SERVICE_URL` names
 * a service, the local Playwright one a composition root registered
 * otherwise. Nothing here imports Playwright, which is what lets the app
 * image ship without it (`lib/__tests__/lean-imports.test.ts`).
 *
 * What stays here is everything the SERVICE must not know: which URL a row is
 * photographed at and with which short-lived signed key, what a shot COVERS
 * as a cache segment, the two-layer cache (in-memory LRU + the object store),
 * the one retry, and the verdict → HTTP mapping. The service renders a URL;
 * the product decides what to render and what a failure means.
 */
import sharp from 'sharp';
import { loadImage } from './story/image-store';
import { createHash } from 'node:crypto';
import { EXPORT_INTERNAL_ORIGIN } from '@/lib/config';
import { services } from '@/lib/services';
import { ArtifactRow, declarationsOf, getArtifactById, referencedArtifactForRow } from './artifacts';
import { CARD_HEIGHT, CARD_RENDER_GENERATION, CARD_WIDTH } from './export-card';
import { mintExportKey } from './export-key';
import { json } from './http';
import { objectStore } from './object-store';
import { urlSelection } from './story/url-values';
import { SOCIAL_PREVIEW_OVERVIEW_GENERATION, clampImageCrop, savedSocialPreviewImageCrop, parseSocialPreviewCrop, socialPreviewCrop, socialPreviewImage, type SocialPreviewCrop } from './story/social-preview';

export const EXPORT_MIME = { png: 'image/png', jpg: 'image/jpeg' } as const;
export type ExportFormat = keyof typeof EXPORT_MIME;

/**
 * What the shot covers. 'full' = the whole document, however tall — agents
 * curl this to eyeball a page. 'card' = the document's saved 40:21 social
 * frame; 'preview' = its bounded, editor-only framing overview. The output
 * size lives in lib/export-card.ts, importable without this module's graph.
 */
export type ExportCapture = 'full' | 'card' | 'preview';

/** Rendered viewport width; height follows the content (full-page capture). */
export const EXPORT_WIDTH = 1200;
const EXPORT_VIEWPORT_HEIGHT = 630; // og card ratio; fullPage grows past it as needed
const RENDER_TIMEOUT_MS = 15_000;
const PAGE_SETTLE_MS = 1500; // live /v pages: charts and embeds hydrate after mount
/** How long to wait before the single re-render (see renderArtifactImage). */
const RENDER_RETRY_MS = 1_000;

/**
 * WHICH RENDERER TOOK THE PICTURE. Shots are cached by artifact version, in
 * memory and in the object store, so a version that was already shot is never
 * re-rendered — which means a change to what a shot COVERS must change the key,
 * or every document already published keeps serving the old picture.
 *
 * Generation 2: a markup document is shot from its own page (`raw?chrome=0`)
 * rather than through the app page's iframe element, whose box is the viewport
 * — "full" used to mean the first screen, on every document ever exported.
 *
 * Bump this whenever the framing changes. Old entries then go cold on their own,
 * exactly like the card key's stage size does.
 */
export const EXPORT_RENDER_GENERATION = 3;
const CACHE_MAX_ENTRIES = 24;

/** `format` value → export format; null when absent or unrecognized. */
export function parseExportFormat(value: string | null): ExportFormat | null {
  return value === 'png' || value === 'jpg' ? value : null;
}

/** `mode` value → capture; ABSENT defaults to 'full', garbage is null (400). */
export function parseExportCapture(value: string | null): ExportCapture | null {
  if (value === null) return 'full';
  return value === 'full' || value === 'card' || value === 'preview' ? value : null;
}

/**
 * `slide` value → 1-based slide index; ABSENT is 0 (the whole document) and
 * anything that is not a positive integer is null (400). A deck is reviewed one
 * slide at a time, and an agent with no way to ask for slide N publishes a
 * throwaway document holding that slide instead — measured, three extra
 * requests and a version row per look.
 */
export function parseExportSlide(value: string | null): number | null {
  if (value === null) return 0;
  return /^[1-9][0-9]*$/.test(value) ? Number(value) : null;
}

/**
 * What this shot IS, as a cache segment: the card carries its stage size (so
 * resizing the card spec orphans old entries instead of serving them), a slice
 * carries its slide number, and the whole-document shot carries the renderer
 * generation.
 */
function exportCaptureKey(capture: ExportCapture, slide: number, selection = ''): string {
  /*
   * A SELECTION IS PART OF WHAT THE SHOT IS. Both cache layers are keyed by
   * artifact version — that is what makes one render serve every unfurl and
   * every profile thumbnail, with no invalidation ever run — and it is also
   * exactly what would hand `?$region=NA` the picture taken of the defaults:
   * same id, same version, same key. Hashed because this string is also an
   * object-store PATH, and short because it only has to separate.
   */
  const pick = selection ? `-p${createHash('sha256').update(selection).digest('hex').slice(0, 12)}` : '';
  if (slide > 0) return `slide-${slide}-g${EXPORT_RENDER_GENERATION}${pick}`;
  if (capture === 'card') return `card-${CARD_WIDTH}x${CARD_HEIGHT}-r${CARD_RENDER_GENERATION}-g${EXPORT_RENDER_GENERATION}${pick}`;
  if (capture === 'preview') return `preview-v${SOCIAL_PREVIEW_OVERVIEW_GENERATION}-g${EXPORT_RENDER_GENERATION}`;
  return `full-g${EXPORT_RENDER_GENERATION}${pick}`;
}

/** The durable cache address for one shot — version-keyed, so an edit misses naturally. */
export function exportStoreKey(
  artifact: Pick<ArtifactRow, 'id' | 'version'>,
  format: ExportFormat,
  capture: ExportCapture,
  slide = 0,
  /** The CANONICAL selection token (lib/story/url-values urlSelection), never raw params. */
  selection = '',
): string {
  return `exports/${artifact.id}/${artifact.version}.${exportCaptureKey(capture, slide, selection)}.${format}`;
}

export type RenderResult =
  | { ok: true; mime: string; bytes: Buffer }
  | { ok: false; reason: 'unavailable' | 'failed' }
  /** The document has fewer slides than were asked for — a 404 that says how many. */
  | { ok: false; reason: 'no_slide'; slides: number };

interface ExportState {
  /**
   * Serialises RENDERS AT THIS DOOR — not for the browser's sake (the package
   * has its own chain and shoots one page at a time), but so two requests for
   * the same shot do not both take a picture: the second finds what the first
   * cached ("a queued twin may have filled it" below).
   */
  chain: Promise<unknown>;
  cache: Map<string, { mime: string; bytes: Buffer }>;
}

declare global {
  // eslint-disable-next-line no-var
  var __artifact_bin_export__: ExportState | undefined;
}

function state(): ExportState {
  if (!global.__artifact_bin_export__) {
    global.__artifact_bin_export__ = { chain: Promise.resolve(), cache: new Map() };
  }
  return global.__artifact_bin_export__;
}

/**
 * WHAT A RENDER WORKS FROM: a live page URL. Every tier renders in the app —
 * a markup document is served as its own page, the data tiers inside the
 * app's measure — so the exporter navigates the real page and shoots an
 * element of it, never the app chrome.
 *
 * The page URL is a THUNK, not a string: it carries a short-lived signed key
 * (lib/export-key.ts), and this render may sit behind a cold browser launch
 * and the serialization queue. Minting at call time let the key die before
 * navigation — and the shot then SUCCEEDED, returning a 200 PNG of a
 * not-found page. Built here, it is always fresh at the moment it is used.
 */
type RenderInput = {
  urlFor: () => string;
  /**
   * What to photograph on that page. A markup document lives in its own frame;
   * the data tiers render as a table, a recipe or an image inside the app's
   * measure. Named by the CALLER, which knows the format — the exporter waiting
   * for a frame that a dataset page never has is a timeout, not a picture.
   */
  target: string;
};

/**
 * THE ONE RENDER REQUEST. Everything the browser needs to take this picture
 * and nothing about this product: a URL (carrying its own key), what to shoot
 * on it, and which capture mode. The service answers bytes or a
 * VERDICT — it never throws — and this is the only place those verdicts are
 * turned into the app's own smaller vocabulary.
 *
 * It answers in the SERVICE's four-verdict vocabulary, not the app's three:
 * `navigation` and `failed` both end as a 500, but only ONE of them may be
 * retried, so collapsing them here would quietly re-render every unreachable
 * page. The narrowing happens after that decision, in renderArtifactImage.
 *
 *   ok           → the bytes                → 200
 *   unavailable  → no browser in this image → 503 render_unavailable
 *   navigation   → the page was not reached → 500 render_failed, NOT retried
 *   failed       → it tried and failed      → 500 render_failed, retried once
 *   no_slide     → fewer slides than asked  → 404 slide_not_found + the count
 */
type Shot =
  | { ok: true; mime: string; bytes: Buffer }
  // One member PER reason, so `reason === 'navigation'` narrows: a single
  // member holding a union of reasons does not, and the compiler cannot then
  // see that the retry branch has ruled navigation out.
  | { ok: false; reason: 'unavailable' }
  | { ok: false; reason: 'navigation' }
  | { ok: false; reason: 'failed' }
  | { ok: false; reason: 'no_slide'; slides: number };

async function renderOnce(
  input: RenderInput,
  format: ExportFormat,
  capture: ExportCapture,
  slide = 0,
  crop?: SocialPreviewCrop,
): Promise<Shot> {
  const rendered = await services().browser.render({
    // The key is minted HERE, at the moment the request goes out — see
    // RenderInput. A cold browser launch is unbounded, and a key that expired
    // in the queue produced a 200 PNG of a 404 page.
    url: input.urlFor(),
    format,
    ...(format === 'jpg' ? { quality: 85 } : {}),
    viewport: capture === 'card' || capture === 'preview'
      ? { width: CARD_WIDTH, height: CARD_HEIGHT }
      : { width: EXPORT_WIDTH, height: EXPORT_VIEWPORT_HEIGHT },
    // BY NAME, not by position: the page also carries the document's static
    // body (for crawlers), which may itself contain a <Video> player frame —
    // `first()` then measured the player and cropped every card to its width.
    selector: input.target,
    capture: slide > 0
      ? { slide }
      : (capture === 'card' || capture === 'preview') && crop
        ? { card: crop }
        : capture,
    // Same-origin requests are the app itself; anything cross-origin is a
    // stray — abort it, which doubles as the CSP discipline for the surface.
    sameOriginOnly: true,
    // The Next dev overlay ("N issues") is fixed to the corner and lands in
    // page-level shots on dev servers; the element doesn't exist in prod.
    injectCss: 'nextjs-portal{display:none !important}',
    settleMs: PAGE_SETTLE_MS,
    timeoutMs: RENDER_TIMEOUT_MS,
  });
  if (rendered.ok) return { ok: true, mime: rendered.mime, bytes: Buffer.from(rendered.bytes) };
  if (rendered.reason === 'no_slide') return { ok: false, reason: 'no_slide', slides: rendered.slides };
  /*
   * The caller gets a NAME (`render_failed`); the operator gets the reason.
   * Without this the whole path was silent: a 500 with `{"error":
   * "render_failed"}` and nothing anywhere saying whether the browser was
   * missing, the page 404'd, or TLS refused — which is exactly what an export
   * behind a reverse proxy looked like from the outside.
   */
  if (rendered.reason !== 'unavailable') console.error(`[export] render ${rendered.reason}:`, rendered.detail ?? '');
  return { ok: false, reason: rendered.reason };
}

/**
 * Render an artifact to image bytes. TWO cache layers sit in front of the
 * browser, both keyed by VERSION so an edit misses naturally and no
 * invalidation is ever run: an in-memory LRU, and the object store behind it.
 * A hit at either costs no browser work at all — which is what makes one
 * render serve every og unfurl and profile thumbnail for that version.
 * `opts.pageUrl` is a thunk, minted per attempt — see RenderInput.
 */
export function renderArtifactImage(
  artifact: Pick<ArtifactRow, 'id' | 'version'>,
  format: ExportFormat,
  // `pageUrl` is REQUIRED: every artifact is shot from its live page. The old
  // optional shape existed so a row could be photographed from its stored HTML
  // instead — which only the retired html tier ever had.
  /** `selection` is the CANONICAL token from urlSelection — a raw search string here
   * would give one document unlimited keys for byte-identical renders. */
  opts: {
    pageUrl: () => string;
    target: string;
    capture?: ExportCapture;
    slide?: number;
    selection?: string;
    crop?: SocialPreviewCrop;
    /** Editor-only draft crops stay in the bounded memory LRU, never durable storage. */
    volatile?: boolean;
  },
): Promise<RenderResult> {
  const s = state();
  const capture = opts.capture ?? 'full';
  const slide = opts.slide ?? 0;
  // The reader's `<Value>` picks, when this shot is of a selected document.
  const selection = opts.selection ?? '';
  const draftKey = opts.volatile && opts.crop
    ? `-draft-${opts.crop.x}-${opts.crop.y}-${opts.crop.width}`
    : '';
  const captureKey = `${exportCaptureKey(capture, slide, selection)}${draftKey}`;
  const key = `${artifact.id}:${artifact.version}:${captureKey}:${format}`;
  const hit = s.cache.get(key);
  if (hit) return Promise.resolve({ ok: true, ...hit });

  // The durable layer: version-keyed, so an edit misses naturally and the
  // stale entry just goes cold — no invalidation to run, ever. One render
  // then serves every og unfurl and profile thumbnail for that version,
  // across restarts.
  const storeKey = opts.volatile ? null : exportStoreKey(artifact, format, capture, slide, selection);
  const input: RenderInput = { urlFor: opts.pageUrl, target: opts.target };
  const run = s.chain.then(async (): Promise<RenderResult> => {
    const cached = s.cache.get(key); // a queued twin may have filled it
    const stored = cached ?? (storeKey ? await objectStore().get(storeKey).then(
      (bytes) => ({ mime: EXPORT_MIME[format], bytes }),
      () => null,
    ) : null);
    if (stored) {
      if (!cached) remember(s, key, stored);
      return { ok: true, ...stored };
    }
    /*
     * ONE retry on a failed render: a shot taken immediately after a write can
     * race the fresh version — the page loads, but what the exporter is waiting
     * for is not there yet — and answers render_failed, which an agent then
     * spends turns diagnosing (measured: two turns on a real run). Only that
     * race is retried: a missing browser ('unavailable'), a missing slide
     * ('no_slide') and an unreachable page ('navigation') are ANSWERS — a
     * server that is not answering answers no faster the second time, and
     * re-asking only doubles the wait before the caller learns.
     *
     * A failure that took the FULL wait already polled for what it wanted and
     * never saw it — that is an answer too, and re-running it only doubles the
     * time before the caller hears it. Only a FAST 'failed' looks like a race.
     */
    const startedAt = Date.now();
    let rendered = await renderOnce(input, format, capture, slide, opts.crop);
    if (!rendered.ok && rendered.reason === 'failed' && Date.now() - startedAt <= RENDER_TIMEOUT_MS / 2) {
      await new Promise((r) => setTimeout(r, RENDER_RETRY_MS));
      rendered = await renderOnce(input, format, capture, slide, opts.crop);
    }
    // Only now do the service's four verdicts become the app's three: the
    // page could not be reached is a FAILURE, never "there is no browser here".
    if (!rendered.ok) return rendered.reason === 'navigation' ? { ok: false, reason: 'failed' } : rendered;
    const shot = { mime: rendered.mime, bytes: rendered.bytes };
    // Best-effort persist: a failed put costs a re-render later, never the shot.
    if (storeKey) await objectStore().put(storeKey, shot.bytes, shot.mime).catch(() => {});
    remember(s, key, shot);
    return { ok: true, ...shot };
  });
  s.chain = run.catch(() => {});
  /*
   * The service answers a VERDICT rather than throwing, so this catch is the
   * backstop for THIS module's own failures (the object store, a bad URL from
   * the thunk) — not for a render that went wrong. The caller still gets a
   * name; the operator gets the reason.
   */
  return run.catch((error): RenderResult => {
    console.error('[export] render failed:', error);
    return { ok: false, reason: 'failed' };
  });
}

/** Keep the newest shots, drop the oldest — a small LRU in front of the store. */
function remember(s: ExportState, key: string, shot: { mime: string; bytes: Buffer }): void {
  if (s.cache.size >= CACHE_MAX_ENTRIES) s.cache.delete(s.cache.keys().next().value as string);
  s.cache.set(key, shot);
}

/**
 * The whole export answer for an ALREADY-AUTHORIZED artifact: parse the
 * caller's format/mode/slide, render, and build the image (or refusal)
 * Response. ONE implementation behind both doors — the `/a/<id>/export` route
 * and the `export_artifact` MCP operation — so caps, error names and cache
 * rules cannot fork. Authorization stays with the CALLER: only a door that
 * has run the read ACL may call this.
 */
export async function exportImageResponse(
  // `source` is here so the SELECTION can be read the way the document itself
  // reads it — through its own declarations. See `selection` below.
  artifact: Pick<ArtifactRow, 'id' | 'version' | 'format' | 'source'>,
  q: { format?: string | null; mode?: string | null; slide?: string | null; crop?: string | null; image?: string | null; search?: string | null },
  base: string,
): Promise<Response> {
  // Default png; anything unrecognized is a client error rather than a
  // surprise format, since this path exists only to produce an image.
  const format = parseExportFormat(q.format ?? 'png');
  if (!format) return json({ error: 'unknown_format', allowed: ['png', 'jpg'] }, 400);
  // Default full page (agents ask for this to see the whole document); 'card'
  // is the saved 1600×840 framing that og:image uses; 'preview' is the private
  // overview used only by editing chrome.
  const capture = parseExportCapture(q.mode ?? null);
  if (!capture) return json({ error: 'unknown_mode', allowed: ['full', 'card', 'preview'] }, 400);
  // One slide of a deck, 1-based. Absent is 0 — the whole document.
  const slide = parseExportSlide(q.slide ?? null);
  if (slide === null) return json({ error: 'unknown_slide', hint: 'slide is a 1-based slide number, e.g. ?slide=2' }, 400);
  const draftCrop = capture === 'preview' && q.crop ? parseSocialPreviewCrop(q.crop) : null;
  if (capture === 'preview' && q.crop && !draftCrop) {
    return json({ error: 'unknown_crop', hint: 'crop must be x=<px>;y=<px>;width=<px>' }, 400);
  }

  /*
   * THE READER'S SELECTION, forwarded to the page this shoots — so
   * `/a/<id>/export?$region=NA` photographs the document the link describes
   * and an agent can look at what its user will see. Never for the CARD: an
   * unfurl is of the DOCUMENT, and one reader's filter is not what the next
   * person should meet in a preview.
   *
   * READ THROUGH THE FLOW, not taken from the params. Forwarding was all this
   * needed; KEYING on it is what made the difference matter. Both cache layers
   * are addressed by artifact VERSION — which is what makes one render serve
   * every unfurl and thumbnail with no invalidation ever run — so a token taken
   * from the raw `$` params gave one document unlimited distinct keys: the
   * document ignores a name it does not declare, a value its type refuses and a
   * value already at its default, so `?$junk=17` renders bytes identical to the
   * default shot and then stores them forever under a key of their own. The
   * EXPORT door bounds the RATE (30/min per actor) and not the TOTAL. Now
   * anything the document would ignore collapses onto the default shot's key,
   * byte for byte, and one selection has one identity however its link was
   * written (lib/story/url-values urlSelection).
   */
  /*
   * A FOLDER IS PHOTOGRAPHED ON THE APP PAGE, and that is the whole of it here:
   * `isDocument` is markup alone again. A folder has no document — its listing
   * is app data the page endpoint answers and `withBootstrap` inlines — so the
   * camera goes to `/a/<id>?key=` with `main` as its target, the path every
   * data tier already takes. The `?key=` is what keeps that address on the SPA
   * (server/app `servesDocumentDirectly` bows out for a key), and the page
   * endpoint honours the same signed key, so the shot carries the OWNER's shelf
   * without the headless browser holding a session.
   *
   * The card's crop goes with it: `socialPreviewCrop` reads a document's source
   * for the author's own framing, and a folder has none.
   *
   * Named once and read at all three sites below — the address, the crop, and
   * the declarations a selection is read through — because a row that is a
   * document for one of them and not the others is a card of the wrong thing.
   */
  const isDocument = artifact.format === 'markup';
  const flow = isDocument && artifact.source ? declarationsOf(artifact.source) : null;
  const imageOverview = capture === 'preview' && q.image === '1';
  const imageId = isDocument && (capture === 'card' || imageOverview) ? socialPreviewImage(artifact.source ?? '') : null;
  if (imageId) {
    // The caller has authorized the document; resolve its admitted reference
    // in the owner's scope, never by an unrestricted image-id lookup.
    const document = await getArtifactById(artifact.id);
    const image = document ? await referencedArtifactForRow(document, imageId) : null;
    if (image?.format === 'image') {
      try {
        const stored = await loadImage(image);
        if (stored) {
          // Normalize EXIF orientation before measuring/extracting so browser
          // coordinates and exported pixels refer to the same image.
          const oriented = await sharp(stored.body).rotate().toBuffer({ resolveWithObject: true });
          let pipeline = sharp(oriented.data);
          const crop = savedSocialPreviewImageCrop(artifact.source ?? '');
          if (!imageOverview && crop) {
            const { width, height } = oriented.info;
            const density = width / CARD_WIDTH;
            const bounded = clampImageCrop(crop, height / density);
            const left = Math.min(width - 1, Math.round(bounded.x * density));
            const top = Math.min(height - 1, Math.round(bounded.y * density));
            pipeline = pipeline.extract({ left, top,
              width: Math.max(1, Math.min(width - left, Math.round(bounded.width * density))),
              height: Math.max(1, Math.min(height - top, Math.round(bounded.width * CARD_HEIGHT / CARD_WIDTH * density))),
            });
          }
          if (!imageOverview) pipeline = pipeline.resize(CARD_WIDTH, CARD_HEIGHT, { fit: 'cover', position: 'centre' });
          const bytes = await (format === 'jpg' ? pipeline.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }) : pipeline.png()).toBuffer();
          return new Response(new Uint8Array(bytes), { headers: {
            'Content-Type': EXPORT_MIME[format],
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': imageOverview ? 'private, no-store' : 'public, max-age=86400',
          } });
        }
      } catch {
        // A removed or unreadable asset falls back to the saved document crop.
      }
    }
  }
  if (imageOverview) return json({ error: 'image_unavailable' }, 404);
  const selection = capture === 'card' || capture === 'preview' ? { search: '', token: '' } : urlSelection(q.search ?? '', flow);

  const rendered = await renderArtifactImage(artifact, format, {
    capture,
    ...(draftCrop
      ? { crop: draftCrop, volatile: true }
      : capture === 'card' && isDocument
        ? { crop: socialPreviewCrop(artifact.source ?? '') }
      : {}),
    ...(selection.token ? { selection: selection.token } : {}),
    // The headless browser has no session, so a private page would 404 on
    // itself. Mint a signed, seconds-long key scoped to this artifact —
    // minted only AFTER the caller's ACL admitted the requester, and never a
    // value any reader has seen. Minted lazily (see RenderInput): a cold
    // browser launch is unbounded, and a key that expired in the queue
    // produced a 200 PNG of a 404 page.
    // A markup document is photographed from its OWN page (`raw?chrome=0` —
    // the document with none of the reading chrome); the data tiers have no
    // document of their own and render inside the app's <main>.
    pageUrl: () => new URL(
      isDocument
        ? `/a/${artifact.id}/raw?chrome=0&key=${mintExportKey(artifact.id)}${selection.search ? `&${selection.search}` : ''}`
        : `/a/${artifact.id}?key=${mintExportKey(artifact.id)}`,
      EXPORT_INTERNAL_ORIGIN ?? base,
    ).toString(),
    // BY NAME, not by position: a served document is the page itself.
    target: isDocument ? 'body' : 'main',
    ...(slide > 0 ? { slide } : {}),
  });
  if (!rendered.ok) {
    // A document with fewer slides than asked for is a missing RESOURCE, and
    // the count is the one thing the caller needs to correct itself in one step.
    if (rendered.reason === 'no_slide') return json({ error: 'slide_not_found', slides: rendered.slides }, 404);
    const unavailable = rendered.reason === 'unavailable';
    return json({ error: unavailable ? 'render_unavailable' : 'render_failed' }, unavailable ? 503 : 500);
  }
  return new Response(new Uint8Array(rendered.bytes), {
    status: 200,
    headers: {
      'Content-Type': rendered.mime,
      'X-Content-Type-Options': 'nosniff',
      // Cards are fetched by browsers en masse (profile grids) behind a
      // version-busted URL (&v=), so they may cache hard. Editor previews are
      // private-cacheable; full shots keep no-store so an agent re-asking
      // after an edit never sees stale output.
      'Cache-Control': draftCrop
        ? 'private, no-store'
        : capture === 'card'
        ? 'public, max-age=86400'
        : capture === 'preview'
          ? 'private, max-age=86400'
          : 'no-store',
    },
  });
}

/**
 * Test hook — drop the render cache and release the browser. The browser is
 * the REGISTERED service's, so this closes whatever is registered (a local
 * Playwright one has a `close`; an HTTP client has nothing to release and does
 * not declare one) rather than a singleton this module owns.
 */
export async function resetExportRenderer(): Promise<void> {
  const s = state();
  s.cache.clear();
  global.__artifact_bin_export__ = undefined;
  await services().browser.close?.();
}

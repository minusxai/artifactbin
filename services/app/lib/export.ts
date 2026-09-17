import {renderSocialPreviewImage} from './story/social-preview-image.server';
/** Export policy and adapters. The DB cache owns refresh coordination; the browser
 * owns readiness/capture/upload; the asset route streams immutable stored images.
 * Routes authorize the artifact before calling this module. */
import sharp from 'sharp';
import {Readable} from 'node:stream';
import type {RenderRequest} from '@artifactbin/contracts';
import {getDb} from './db';
import {createExportCache,type ExportImage} from './export/cache';
import {exportAssetUrl} from './export/assets';
import { loadImage } from './story/image-store';
import { createHash } from 'node:crypto';
import { ASSETS_ORIGIN, EXPORT_INTERNAL_ORIGIN } from '@/lib/config';
import { services } from '@/lib/services';
import { ArtifactRow, declarationsForRow, getArtifactById, referencedArtifactForRow } from './artifacts';
import { CARD_HEIGHT, CARD_RENDER_GENERATION, CARD_WIDTH } from './export-card';
import { mintExportKey } from './export-key';
import { json } from './http';
import { objectStore } from './object-store';
import { urlSelection } from './story/url-values';
import { SOCIAL_PREVIEW_OVERVIEW_GENERATION, parseSocialPreviewCrop, socialPreviewCrop, socialPreviewImage, type SocialPreviewCrop } from './story/social-preview';

const EXPORT_MIME = { png: 'image/png', jpg: 'image/jpeg' } as const;
type ExportFormat = keyof typeof EXPORT_MIME;

/**
 * What the shot covers. 'full' = the whole document, however tall — agents
 * curl this to eyeball a page. 'card' = the document's saved 40:21 social
 * frame; 'preview' = its bounded, editor-only framing overview. The output
 * size lives in lib/export-card.ts, importable without this module's graph.
 */
type ExportCapture = 'full' | 'card' | 'preview';

/** Rendered viewport width; height follows the content (full-page capture). */
const EXPORT_WIDTH = 1200;
const EXPORT_VIEWPORT_HEIGHT = 630; // og card ratio; fullPage grows past it as needed
const RENDER_TIMEOUT_MS = 30_000;
const PAGE_SETTLE_MS = 1500; // live /v pages: charts and embeds hydrate after mount
/** How long to wait before the single re-render (see renderArtifactImage). */
const RENDER_RETRY_MS = 1_000;

/** Bump to invalidate images made by an older capture implementation. */
export const EXPORT_RENDER_GENERATION = 6;


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
  // Only canonical document selections split the cache, never arbitrary query parameters.
  const pick = selection ? `-p${createHash('sha256').update(selection).digest('hex').slice(0, 12)}` : '';
  if (slide > 0) return `slide-${slide}-g${EXPORT_RENDER_GENERATION}${pick}`;
  if (capture === 'card') return `card-${CARD_WIDTH}x${CARD_HEIGHT}-r${CARD_RENDER_GENERATION}-g${EXPORT_RENDER_GENERATION}${pick}`;
  if (capture === 'preview') return `preview-v${SOCIAL_PREVIEW_OVERVIEW_GENERATION}-g${EXPORT_RENDER_GENERATION}`;
  return `full-g${EXPORT_RENDER_GENERATION}${pick}`;
}

type ExportIdentity = Pick<ArtifactRow, 'id' | 'version'> & Partial<Pick<ArtifactRow, 'edit_id'>>;

/** Repairs rotate edit_id while preserving history's public version numbers. */
function exportRevision(artifact: ExportIdentity): string {
  const edit = artifact.edit_id
    ? `-e${createHash('sha256').update(artifact.edit_id).digest('hex').slice(0, 16)}`
    : '';
  return `${artifact.version}${edit}`;
}

/** Stable output identity; revision freshness is tracked separately in the DB. */
export function exportCacheKey(
  artifact: ExportIdentity,
  format: ExportFormat,
  capture: ExportCapture,
  slide = 0,
  /** The CANONICAL selection token (lib/story/url-values urlSelection), never raw params. */
  selection = '',
): string {
  return `${artifact.id}:${exportCaptureKey(capture, slide, selection)}:${format}`;
}

export type RenderResult =
  | { ok: true; mime: string; bytes: Buffer }
  | { ok: false; reason: 'unavailable' | 'failed' }
  /** The document has fewer slides than were asked for — a 404 that says how many. */
  | { ok: false; reason: 'no_slide'; slides: number };

let cache:Promise<ReturnType<typeof createExportCache>>|undefined;
const sharedCache=()=>cache??=(getDb().then(db=>createExportCache(db)));
class RenderFailure extends Error {
  constructor(readonly result:Exclude<RenderResult,{ok:true}>){super(result.reason);}
}
type ResolvedImage = {ok:true;image:ExportImage} | Exclude<RenderResult,{ok:true}>;

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

function renderRequest(
  input: RenderInput,
  format: ExportFormat,
  capture: ExportCapture,
  slide = 0,
  crop?: SocialPreviewCrop,
): RenderRequest {
  return {
    // The key is minted HERE, at the moment the request goes out — see
    // RenderInput. A key minted earlier can expire while the request waits, and
    // the shot then SUCCEEDS against a 404 page: a 200 PNG of it.
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
    ...(ASSETS_ORIGIN ? { assetOrigin: ASSETS_ORIGIN } : {}),
    waitForManagedFrames: true,
    settleMs: PAGE_SETTLE_MS,
    timeoutMs: RENDER_TIMEOUT_MS,
  };
}

async function renderOnce(input:RenderInput,format:ExportFormat,capture:ExportCapture,slide=0,crop?:SocialPreviewCrop,timeoutMs=RENDER_TIMEOUT_MS):Promise<Shot>{
  const rendered=await services().browser.render({...renderRequest(input,format,capture,slide,crop),timeoutMs});
  if (rendered.ok) return { ok: true, mime: rendered.mime, bytes: Buffer.from(rendered.bytes) };
  if (rendered.reason === 'no_slide') return { ok: false, reason: 'no_slide', slides: rendered.slides };
  // Report the verdict without logging signed navigation URLs from service details.
  if (rendered.reason !== 'unavailable') console.error(`[export] render ${rendered.reason}`);
  return { ok: false, reason: rendered.reason };
}

interface ImageOptions {
 pageUrl:()=>string;target:string;capture?:ExportCapture;slide?:number;selection?:string;
 crop?:SocialPreviewCrop;volatile?:boolean;refresh?:boolean;
}
async function renderWithRetry(input:RenderInput,format:ExportFormat,capture:ExportCapture,slide=0,crop?:SocialPreviewCrop):Promise<Shot>{
 const started=Date.now();let result=await renderOnce(input,format,capture,slide,crop);
 if(!result.ok&&result.reason==='failed'&&Date.now()-started<=RENDER_TIMEOUT_MS/2){
  await new Promise(r=>setTimeout(r,RENDER_RETRY_MS));
  result=await renderOnce(input,format,capture,slide,crop,Math.max(1,RENDER_TIMEOUT_MS-(Date.now()-started)));
 }
 return result;
}
async function storeBytes(id:string,bytes:Buffer,format:ExportFormat):Promise<Omit<ExportImage,'id'|'artifact_id'>>{
 const meta=await sharp(bytes).metadata();
 if(!meta.width||!meta.height)throw new Error('Image dimensions missing');
 const object_key=`exports/objects/${id}.${format}`,mime=EXPORT_MIME[format];
 await objectStore().put(object_key,bytes,mime);
 return {object_key,mime,bytes:bytes.length,width:meta.width,height:meta.height};
}
async function resolveArtifactImage(artifact:ExportIdentity,format:ExportFormat,opts:ImageOptions):Promise<ResolvedImage>{
 const capture=opts.capture??'full',slide=opts.slide??0;
 try {
  const image=await (await sharedCache()).read({
   cacheKey:exportCacheKey(artifact,format,capture,slide,opts.selection),
   artifactId:artifact.id,revision:exportRevision(artifact),refresh:opts.refresh,
  },async id=>{
   const input={urlFor:opts.pageUrl,target:opts.target},store=objectStore(),browser=services().browser;
   if(store.signedUpload&&browser.renderAndUpload){
    const object_key=`exports/objects/${id}.${format}`;
    const upload=await store.signedUpload(object_key,EXPORT_MIME[format]);
    const result=await browser.renderAndUpload({render:renderRequest(input,format,capture,slide,opts.crop),upload});
    if(result.ok)return {object_key,mime:result.mime,bytes:result.bytes,width:result.width,height:result.height};
    if(result.reason!=='upload_unavailable')throw new RenderFailure(result.reason==='no_slide'?{ok:false,reason:'no_slide',slides:result.slides}:{ok:false,reason:result.reason==='unavailable'?'unavailable':'failed'});
    // A mixed-version or unconfigured browser retains the original byte
    // transport. Upload failures themselves never silently switch transports.
   }
   const result=await renderWithRetry(input,format,capture,slide,opts.crop);
   if(!result.ok)throw new RenderFailure(result.reason==='no_slide'?{ok:false,reason:'no_slide',slides:result.slides}:{ok:false,reason:result.reason==='unavailable'?'unavailable':'failed'});
   return storeBytes(id,result.bytes,format);
  });
  return {ok:true,image};
 }catch(error){return error instanceof RenderFailure?error.result:{ok:false,reason:'failed'};}
}
/** Binary adapter used by operations; completed exports are never retained in RAM. */
export async function renderArtifactImage(artifact:ExportIdentity,format:ExportFormat,opts:ImageOptions):Promise<RenderResult>{
 if(opts.volatile){
  const result=await renderWithRetry({urlFor:opts.pageUrl,target:opts.target},format,opts.capture??'full',opts.slide,opts.crop);
  return !result.ok&&result.reason==='navigation'?{ok:false,reason:'failed'}:result;
 }
 const resolved=await resolveArtifactImage(artifact,format,opts);
 if(!resolved.ok)return resolved;
 try {
  const stream=await objectStore().getStream(resolved.image.object_key),chunks:Buffer[]=[];
  for await(const chunk of stream)chunks.push(Buffer.from(chunk));
  return {ok:true,mime:resolved.image.mime,bytes:Buffer.concat(chunks)};
 }catch{return {ok:false,reason:'failed'};}
}
async function imageResponse(image:ExportImage,base:string,delivery:'bytes'|'redirect'):Promise<Response>{
 if(delivery==='redirect'){
  const asset=new URL(exportAssetUrl(image.id,base));
  // The CLI deliberately refuses cross-origin HTTP grants. Local hosts with
  // an isolated asset hostname deliver bytes through the authorized origin.
  if(asset.protocol==='https:'||asset.origin===new URL(base).origin)
   return new Response(null,{status:302,headers:{location:asset.toString(),'cache-control':'no-store'}});
 }
 const stream=await objectStore().getStream(image.object_key);
 return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>,{headers:{'content-type':image.mime,'cache-control':'no-store','x-content-type-options':'nosniff'}});
}

/**
 * The whole export answer for an ALREADY-AUTHORIZED artifact: parse the
 * caller's format/mode/slide, render, and build the image (or refusal)
 * Response. ONE implementation behind both doors — the `/a/<id>/export` route
 * and the `export_artifact` operation — so caps, error names and cache
 * rules cannot fork. Authorization stays with the CALLER: only a door that
 * has run the read ACL may call this.
 */
export async function exportImageResponse(
  // `source` is here so the SELECTION can be read the way the document itself
  // reads it — through its own declarations. See `selection` below.
  artifact: ExportIdentity & Pick<ArtifactRow, 'format' | 'source'>,
  q: { format?: string | null; mode?: string | null; slide?: string | null; crop?: string | null; image?: string | null; search?: string | null; refresh?: string | null },
  base: string,
  delivery:'bytes'|'redirect'='bytes',
): Promise<Response> {
  // Default png; anything unrecognized is a client error rather than a
  // surprise format, since this path exists only to produce an image.
  if(q.refresh!=null&&q.refresh!=='1')return json({error:'unknown_refresh'},400);
  const format = parseExportFormat(q.format ?? 'png');
  if (!format) return json({ error: 'unknown_format', allowed: ['png', 'jpg'] }, 400);
  // Default full page (agents ask for this to see the whole document); 'card'
  // is the saved 1600×840 framing that og:image uses; 'preview' is the private
  // overview used only by editing chrome.
  const capture = parseExportCapture(q.mode ?? null);
  if (!capture) return json({ error: 'unknown_mode', allowed: ['full', 'card', 'preview'] }, 400);
  // One slide of a deck, 1-based. Absent is 0 — the whole document.
  const slide = parseExportSlide(q.slide ?? null);
  if (slide === null) return json({ error: 'unknown_slide', hint: 'a slide is a 1-based slide number of this document; select one with --page, e.g. afbin export <ref> --format png --page 2' }, 400);
  const draftCrop = capture === 'preview' && q.crop ? parseSocialPreviewCrop(q.crop) : null;
  if (capture === 'preview' && q.crop && !draftCrop) {
    return json({ error: 'unknown_crop', hint: 'crop must be x=<px>;y=<px>;width=<px>' }, 400);
  }

  // Full captures honor canonical reader selections; social cards use saved defaults.
  const isDocument = artifact.format === 'markup';
  const flow = isDocument ? declarationsForRow(artifact)?.flow ?? null : null;
  const imageOverview = capture === 'preview' && q.image === '1';
  const imageId = isDocument && (capture === 'card' || imageOverview) ? socialPreviewImage(artifact.source ?? '') : null;
  if (imageId) {
    // The caller has authorized the document; resolve its admitted reference
    // in the owner's scope, never by an unrestricted image-id lookup.
    const document = await getArtifactById(artifact.id);
    const image = document ? await referencedArtifactForRow(document, imageId) : null;
    if (image?.format === 'image') {
      try {
        const produceCover=async()=>{
          const stored = await loadImage(image);
          if(!stored)throw new Error('Cover unavailable');
          return renderSocialPreviewImage(stored.body,artifact.source??'',format,imageOverview);
        };
        if(imageOverview)return new Response(new Uint8Array(await produceCover()),{headers:{'content-type':EXPORT_MIME[format],'cache-control':'private, no-store','x-content-type-options':'nosniff'}});
        const cover=await (await sharedCache()).read({
          cacheKey:`${artifact.id}:cover-g${EXPORT_RENDER_GENERATION}:${format}`,
          artifactId:artifact.id,revision:`${exportRevision(artifact)}:${image.id}:${exportRevision(image)}`,refresh:q.refresh==='1',
        },async id=>storeBytes(id,await produceCover(),format));
        return imageResponse(cover,base,delivery);
      } catch {
        // A removed or unreadable asset falls back to the saved document crop.
      }
    }
  }
  if (imageOverview) return json({ error: 'image_unavailable' }, 404);
  const selection = capture === 'card' || capture === 'preview' ? { search: '', token: '' } : urlSelection(q.search ?? '', flow);

  const options:ImageOptions = {
    refresh:q.refresh==='1',
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
    // value any reader has seen. Minted lazily (see RenderInput): a key that
    // expires while the request waits produces a 200 PNG of a 404 page.
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
  };
  const rendered=options.volatile||capture==='preview'
    ? await renderArtifactImage(artifact,format,{...options,volatile:true})
    : await resolveArtifactImage(artifact,format,options);
  if (!rendered.ok) {
    // A document with fewer slides than asked for is a missing RESOURCE, and
    // the count is the one thing the caller needs to correct itself in one step.
    if (rendered.reason === 'no_slide') return json({ error: 'slide_not_found', slides: rendered.slides }, 404);
    const unavailable = rendered.reason === 'unavailable';
    return json({ error: unavailable ? 'render_unavailable' : 'render_failed' }, unavailable ? 503 : 500);
  }
  if('image' in rendered)return imageResponse(rendered.image,base,delivery);
  return new Response(new Uint8Array(rendered.bytes), {
    status: 200,
    headers: {
      'Content-Type': rendered.mime,
      'X-Content-Type-Options': 'nosniff',
      // Editor overviews are versioned by their caller; draft crops are ephemeral.
      'Cache-Control': draftCrop ? 'private, no-store' : 'private, max-age=86400',
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
  if(cache)await (await cache).drain();
  cache=undefined;
  await services().browser.close?.();
}

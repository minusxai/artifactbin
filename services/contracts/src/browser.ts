import type { BrowserSessions } from './browser-sessions';
/**
 * THE BROWSER SERVICE — a Chromium that renders a URL to an image. Rendering is
 * stateless: the app hands it a URL (carrying its own short-lived signed key)
 * and gets bytes or a VERDICT back. The verdict is part of the contract because
 * the app's retry decision and its 503-vs-500 split depend on which failure it
 * was. The service's one STATEFUL surface is optional `sessions` (below,
 * `./browser-sessions`): persistent isolated browser sessions that keep their
 * context and pages across calls (services/browser/src/sessions.ts owns leases, receipts and serialisation).
 *
 * There is no PDF: the product exports png and jpg, element-scoped by a
 * selector, with full, card, positioned-card, preview, slide and element
 * capture modes. `card` is a measure→resize→measure→clip dance inside one page load
 * and is therefore a named mode, not a client recipe.
 */
type RenderFormat = 'png' | 'jpg';
interface RenderCardCrop {
  /** Top-left coordinates relative to the selected surface. */
  x: number;
  y: number;
  /** Source width; source height follows the requested viewport's aspect ratio. */
  width: number;
}

/** Slide capture selects laid-out author-owned data-af-slide elements outside deck chrome, in document order, and draws
 * the chosen one alone (revealed, the others hidden), so a stacked deck's inactive slides export too.
 * Generated data-af-deck-chrome is excluded only during capture; authored content and live navigation remain unchanged. */
/**
 * Element capture: the first element under the surface (or under slide `slide`, revealed as a slide capture reveals
 * it) that `element`, a CSS selector, matches in the page's own document, drawn alone at ELEMENT_CAPTURE.density with
 * whatever the page paints behind it. The selector is untrusted: the service matches it with the document's
 * `querySelector`, never as a Playwright selector, so nothing but the page's CSS reads it.
 */
interface RenderElementCapture { element: string; slide?: number }
type RenderCapture = 'full' | 'card' | 'preview' | { slide: number } | { card: RenderCardCrop } | RenderElementCapture;

/**
 * Element capture's bounds. A selector is at most `selectorChars` long. A match is drawn at `density` device pixels per
 * CSS pixel while both sides are at most `maxCssPx / density`, at 1x up to `maxCssPx`, and refused past it.
 */
export const ELEMENT_CAPTURE = { selectorChars: 200, density: 2, maxCssPx: 8192 } as const;
/** Why an element capture drew nothing: no match, a match with no size or not visible, not CSS, or too large. */
export type NoElement =
  | { ok: false; reason: 'no_element'; why: 'none' | 'hidden' | 'invalid' }
  | { ok: false; reason: 'no_element'; why: 'too_large'; width: number; height: number };

/** One page load, as every operation that loads a page asks for it: where, how big, and what may load. */
export interface PageRequest {
  url: string;
  viewport: { width: number; height: number };
  /** The element to shoot (or harvest under): `body` for a markup document, `main` for a data tier. */
  selector: string;
  /** Abort every request the page makes to another origin (the document is self-contained by rule). */
  sameOriginOnly?: boolean;
  /** Exact additional first-party origins allowed while `sameOriginOnly` remains enforced. */
  allowedOrigins?: string[];
  /** Public cached-asset origin; approved byte requests are fulfilled through the render URL's internal origin, without credentials or redirects. */
  assetOrigin?: string;
  /** Wait for every managed iframe under the capture surface to finish its existing author-ready handshake. */
  waitForManagedFrames?: boolean;
  /**
   * Wait, at most this many ms, until every script component mount (`[data-mx-mount]`) under the surface has been
   * rendered by the page's script, i.e. no longer shows only its server fallback. Reaching the cap is not a failure:
   * the shot is taken with whatever the mounts show.
   */
  waitForMountsMs?: number;
  /** Extra CSS applied before the shot (hide dev overlays, etc.). */
  injectCss?: string;
  /** Fixed wait after the selector appears, for embeds to hydrate. */
  settleMs?: number;
  timeoutMs?: number;
}

export interface RenderRequest extends PageRequest {
  format: RenderFormat;
  /** jpg only, 0-100. */
  quality?: number;
  capture: RenderCapture;
}

/**
 * The SVG drawings a page drew, as text: every element under `selector`
 * matching `collect` that holds an `<img>` whose src is an SVG `data:` URL —
 * the form in which the kit's diagrams are drawn.
 * Loaded `loads` times (1-3, default 1) in fresh pages, so a caller can tell a
 * reproducible drawing from one that differs per load.
 */
export interface SvgHarvestRequest extends PageRequest {
  collect: string;
  loads?: number;
}
/** One drawing: the collected element's own `data-*` attributes, the image's width/height attributes, and the SVG. */
export interface HarvestedSvg { attributes: Record<string, string>; width: number | null; height: number | null; svg: string }
export type SvgHarvestResult =
  | { ok: true; loads: HarvestedSvg[][] }
  | { ok: false; reason: 'unavailable' | 'navigation' | 'failed'; detail?: string }
  /** The service predates this operation (a mixed-version rollout): nothing to harvest with. */
  | { ok: false; reason: 'harvest_unavailable' };
/** Bounds a harvest answer: drawings per load, bytes per drawing, and bytes in all. */
export const SVG_HARVEST_LIMITS = { images: 200, imageBytes: 2 * 1024 * 1024, totalBytes: 24 * 1024 * 1024, loads: 3 } as const;

/**
 * `element: true` says an element capture was drawn as one: a service that predates element capture answers the whole
 * surface without it, and the caller must not take that for the element (a mixed-version rollout).
 */
export type RenderResult =
  | { ok: true; mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array; element?: true }
  | { ok: false; reason: 'unavailable' | 'navigation' | 'failed'; detail?: string }
  | { ok: false; reason: 'no_slide'; slides: number }
  | NoElement;

/** A narrowly scoped signed PUT URL; never exposed to the rendered page. */
export interface RenderUploadRequest { render:RenderRequest; upload:{url:string;contentType:'image/png'|'image/jpeg'} }
export type RenderUploadResult =
 | {ok:false;reason:'upload_unavailable'}
 | {ok:true;mime:'image/png'|'image/jpeg';bytes:number;width:number;height:number;element?:true}
 | Exclude<RenderResult,{ok:true}>;

export interface BrowserService {
  render(request: RenderRequest): Promise<RenderResult>;
  renderAndUpload?(request:RenderUploadRequest):Promise<RenderUploadResult>;
  /** Optional: an older service or a noop answers `harvest_unavailable` (or lacks the method). */
  harvestSvg?(request: SvgHarvestRequest): Promise<SvgHarvestResult>;
  sessions?: BrowserSessions;
  /** Release the browser (a local implementation holds one); a client has nothing to release. */
  close?(): Promise<void>;
}

/** Over HTTP, the image answer's header carrying RenderResult `element`. */
export const ELEMENT_CAPTURE_HEADER = 'x-artifactbin-element-capture';
export const BROWSER_ROUTES = { render: '/render', renderUpload:'/render-upload', harvest: '/harvest', sessions: '/sessions' } as const;

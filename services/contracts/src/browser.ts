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
  /** Abort every request the page makes to another origin (the document is self-contained by rule). Whatever it says, a
   * render reaches no other origin over the network, by any protocol (the browser service's egress proxy). */
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
 * THE PAGE'S OWN PROBLEMS (`inspect`): the same ready page a render photographs, loaded once, and what went wrong in
 * it, as its author needs to hear it: a native component that failed (`[data-af-error]`: its tag, code, label and the
 * sentence it shows), an uncaught exception, a console error, a request that failed or answered 400 or more (one this
 * browser refused by its own `sameOriginOnly` rule is not the page's problem), text too faint to read (`contrast`: shown
 * text under 2:1 against the solid background behind it, once per pair of colours, naming the first element, its words
 * and both colours as the page computed them), a page wider than its window when asked (`overflow`) and a page that never
 * finished drawing (`timeout`). Repeats are said once;
 * at most
 * PAGE_PROBLEM_LIMITS.problems, each text cut to its limit, `truncated` when more were seen.
 *
 * `internalOrigin`: the page loads under its public origin (its CSP, its relative links and its origin checks hold),
 * but every GET or HEAD to the page's origin or an `allowedOrigins` origin is fetched from this origin instead, with
 * the request's own `Host`, no browser header or credential, no redirect, bounded; any other method is refused. So a
 * page on a public host name the browser's network cannot resolve is still loaded from the app itself.
 */
export interface PageInspectRequest extends PageRequest {
  internalOrigin?: string;
  /** Also answer a JPEG of the page as it stood once read, unscaled: its top, the viewport's width by the page's height,
   * each up to PAGE_IMAGE_LIMITS.width and .height (an image reader refuses a larger side), at most
   * PAGE_IMAGE_LIMITS.bytes (lowering its quality, else none). */
  screenshot?: boolean;
  /** Also say a page wider than its window (`overflow`: how much wider, naming the outermost elements that stick out).
   * An older service ignores it and answers no such problem. */
  overflow?: boolean;
  /** Who this check is charged to, each key spending from its own hour (CheckCharge); the browser service keeps the
   * count for every app process at once. An older service ignores it (the app keeps its own bounds as well). */
  charge?: CheckCharge[];
}
/**
 * One key a check spends from, in the one browser service: at most one of its checks in the check lane at a time, at
 * most `perHour` checks and `msPerHour` of browser time in the last hour. Past any, the check is refused (`busy`,
 * `rate_limited`) before it is loaded.
 */
export interface CheckCharge { key: string; perHour: number; msPerHour: number }
/** A page's picture: `data` the JPEG, base64; `bytes` its decoded length. */
export interface PageImage { mime: 'image/jpeg'; width: number; height: number; bytes: number; data: string }
export const PAGE_IMAGE_LIMITS = { bytes: 2_000_000, width: 2_000, height: 2_000 } as const;
export interface PageProblem {
  kind: 'component' | 'script' | 'console' | 'request' | 'contrast' | 'overflow' | 'timeout';
  message: string;
  /** A component's tag name, its `data-af-error` code and its label (`label` or `aria-label`); faint text's element
   * (`tag.class`). */
  element?: string;
  code?: string;
  label?: string;
}
export const PAGE_PROBLEM_LIMITS = { problems: 20, message: 500, element: 40, code: 64, label: 120 } as const;
export type PageInspection =
  | { ok: true; problems: PageProblem[]; truncated: boolean; image?: PageImage }
  | { ok: false; reason: 'unavailable' | 'navigation' | 'failed'; detail?: string }
  /** The check lane is full or one of its charges already has a check in it (`busy`), or a charge's hour is spent. */
  | { ok: false; reason: 'busy' | 'rate_limited'; detail?: string }
  /** The service predates this operation (a mixed-version rollout): nothing was inspected. */
  | { ok: false; reason: 'inspect_unavailable' };

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
  /** Optional: an older service or a noop answers `inspect_unavailable` (or lacks the method). */
  inspect?(request: PageInspectRequest): Promise<PageInspection>;
  sessions?: BrowserSessions;
  /** Release the browser (a local implementation holds one); a client has nothing to release. */
  close?(): Promise<void>;
}

/** Over HTTP, the image answer's header carrying RenderResult `element`. */
export const ELEMENT_CAPTURE_HEADER = 'x-artifactbin-element-capture';
export const BROWSER_ROUTES = { render: '/render', renderUpload:'/render-upload', harvest: '/harvest', inspect: '/inspect', sessions: '/sessions' } as const;

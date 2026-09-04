/**
 * THE BROWSER SERVICE — a Chromium that renders a URL to an image. Stateless:
 * the app hands it a URL (carrying its own short-lived signed key) and gets
 * bytes or a VERDICT back. The verdict is part of the contract because the
 * app's retry decision and its 503-vs-500 split depend on which failure it was.
 *
 * There is no PDF: the product exports png and jpg, element-scoped by a
 * selector, with full, card, positioned-card, preview, and slide capture
 * modes. `card` is a measure→resize→measure→clip dance inside one page load
 * and is therefore a named mode, not a client recipe.
 */
export type RenderFormat = 'png' | 'jpg';
export interface RenderCardCrop {
  /** Top-left coordinates relative to the selected surface. */
  x: number;
  y: number;
  /** Source width; source height follows the requested viewport's aspect ratio. */
  width: number;
}

export type RenderCapture = 'full' | 'card' | 'preview' | { slide: number } | { card: RenderCardCrop };

export interface RenderRequest {
  url: string;
  format: RenderFormat;
  /** jpg only, 0-100. */
  quality?: number;
  viewport: { width: number; height: number };
  /** The element to shoot: `body` for a markup document, `main` for a data tier. */
  selector: string;
  capture: RenderCapture;
  /** Abort every request the page makes to another origin (the document is self-contained by rule). */
  sameOriginOnly?: boolean;
  /** Extra CSS applied before the shot (hide dev overlays, etc.). */
  injectCss?: string;
  /** Fixed wait after the selector appears, for embeds to hydrate. */
  settleMs?: number;
  timeoutMs?: number;
}

export type RenderResult =
  | { ok: true; mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array }
  | { ok: false; reason: 'unavailable' | 'navigation' | 'failed'; detail?: string }
  | { ok: false; reason: 'no_slide'; slides: number };

export interface BrowserService {
  render(request: RenderRequest): Promise<RenderResult>;
  /** Release the browser (a local implementation holds one); a client has nothing to release. */
  close?(): Promise<void>;
}

export const BROWSER_ROUTES = { render: '/render' } as const;

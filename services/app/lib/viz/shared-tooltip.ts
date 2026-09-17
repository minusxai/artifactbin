/**
 * Browser DOM controller for the shared multi-series tooltip CARD. The
 * vertical guide line is NOT here — it's a native Vega `rule` mark injected behind the
 * data (see VegaChart), so it aligns exactly with the points and sits behind the bars.
 * The card content (all series at x, color swatches) is built by the pure `tooltip-plan`
 * module; this only positions and shows/hides. Browser-only.
 */
import { ensureTooltipStyles } from './tooltip-styles';
import { installTooltipDismiss, lastPointerType, decorateForOpener, offsetForOpener } from './tooltip-dismiss';

const PAD = 16;

export class SharedTooltip {
  private el: HTMLElement;
  private doc: Document;
  /** The dismiss policy's release — a card that outlives its chart is the bug this closes. */
  private release: () => void;

  /**
   * `chart` is the element the dismiss policy is scoped to: a press inside it picks the next
   * x, a press anywhere else puts the card away (see `tooltip-dismiss`). It is required
   * rather than defaulted, because a card with no chart to be "outside of" is exactly the
   * stuck card on a phone.
   */
  constructor(private theme: 'light' | 'dark', doc: Document, chart: Element) {
    this.doc = doc;
    ensureTooltipStyles(doc);
    // Our OWN element (not Vega's `#vg-tooltip-element`) — sharing it fought the default
    // per-mark tooltip that pie/scatter/maps still use, leaving that one stuck hidden.
    let el = doc.getElementById('mx-shared-tooltip');
    if (!el) {
      el = doc.createElement('div');
      el.id = 'mx-shared-tooltip';
      (doc.fullscreenElement ?? doc.body).appendChild(el);
    }
    this.el = el;
    this.release = installTooltipDismiss(doc, chart, () => this.hide());
  }

  /** Show the tooltip near the cursor, flipped to stay on-screen. */
  show(html: string, cursorX: number, cursorY: number): void {
    const el = this.el;
    el.className = `mx-tt-shared${this.theme === 'dark' ? ' dark-theme' : ''}`;
    el.innerHTML = html;
    el.style.position = 'fixed';
    el.style.zIndex = '1000';
    el.style.pointerEvents = 'none';
    el.style.visibility = 'visible';
    el.style.display = 'block';
    // AFTER innerHTML, which would otherwise delete the button on every move.
    const opener = lastPointerType(this.doc);
    decorateForOpener(el, opener, () => this.hide());

    const pad = offsetForOpener(opener, PAD);
    const r = el.getBoundingClientRect();
    let x = cursorX + pad;
    let y = cursorY + pad;
    const viewport = this.doc.defaultView;
    if (viewport && x + r.width > viewport.innerWidth) x = cursorX - r.width - pad;
    if (viewport && y + r.height > viewport.innerHeight) y = cursorY - r.height - pad;
    el.style.left = `${Math.max(4, x)}px`;
    el.style.top = `${Math.max(4, y)}px`;
  }

  hide(): void {
    this.el.style.display = 'none';
  }

  destroy(): void {
    this.release();
    this.hide();
  }
}

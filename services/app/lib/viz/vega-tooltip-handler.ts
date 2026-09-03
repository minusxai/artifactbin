/**
 * A document-aware version of vega-tooltip's cursor handler.
 *
 * VegaChart can render in the top document or in a same-origin dashboard/story iframe.
 * The upstream handler closes over the JavaScript realm's global `document`/`window`,
 * so an iframe pointer's client coordinates were applied to a tooltip in the top
 * document. Keeping the tooltip in the chart container's ownerDocument makes the
 * event coordinates, fixed positioning, and viewport collision checks agree.
 */
import { escapeHTML, formatValue } from 'vega-tooltip';
import { ensureTooltipStyles } from './tooltip-styles';
import { installTooltipDismiss, lastPointerType, decorateForOpener, offsetForOpener } from './tooltip-dismiss';

const TOOLTIP_ID = 'vg-tooltip-element';
const OFFSET = 10;

type VegaTooltipHandler = (handler: unknown, event: MouseEvent, item: unknown, value: unknown) => void;

function getTooltipElement(doc: Document): HTMLElement {
  ensureTooltipStyles(doc);
  let el = doc.getElementById(TOOLTIP_ID);
  if (!el) {
    el = doc.createElement('div');
    el.id = TOOLTIP_ID;
    (doc.fullscreenElement ?? doc.body).appendChild(el);
  }

  // These structural styles normally come from vega-tooltip's injected stylesheet.
  // Set them inline because that stylesheet is also installed in the wrong document.
  el.style.position = 'fixed';
  el.style.zIndex = '1000';
  el.style.pointerEvents = 'none';
  el.style.whiteSpace = 'pre-line';
  return el;
}

/**
 * Hide the per-mark card, whoever put it up.
 *
 * Vega hides it by calling the handler with an empty value, which it does on scenegraph
 * `mouseout` — an event a TAP never produces, and one a chart that is being torn down will
 * never produce again. So a rebuild (theme flip, resize epoch, legend re-plan) with the card
 * up used to orphan a visible, `position: fixed`, `pointer-events: none` card in the body with
 * no view left to close it. Every teardown calls this.
 */
export function hideVegaTooltip(doc: Document): void {
  const el = doc.getElementById(TOOLTIP_ID);
  if (!el) return;
  el.className = 'vg-tooltip';
  el.style.visibility = 'hidden';
}

/**
 * The dismiss policy is installed ONCE PER DOCUMENT, not once per chart: there is one shared
 * `#vg-tooltip-element`, so N charts installing N policies would mean chart B's "a pointerdown
 * outside me" hiding the card chart A just opened. The scope follows whichever chart last
 * asked for a handler or showed the card; `createVegaTooltipHandler` runs on every rebuild, so
 * re-scoping must be idempotent or each rebuild would stack another set of listeners.
 */
const policies = new WeakMap<Document, { chart: Element; release: () => void }>();

function scopeDismissTo(doc: Document, chart: Element): void {
  const current = policies.get(doc);
  if (current?.chart === chart) return;
  current?.release();
  policies.set(doc, { chart, release: installTooltipDismiss(doc, chart, () => hideVegaTooltip(doc)) });
}

/** Create a Vega tooltip callback scoped to the rendered chart's document. */
export function createVegaTooltipHandler(
  container: HTMLElement,
  theme: 'light' | 'dark',
): VegaTooltipHandler {
  const doc = container.ownerDocument;
  scopeDismissTo(doc, container);

  return (_handler, event, _item, value) => {
    const el = getTooltipElement(doc);
    if (value == null || value === '') {
      hideVegaTooltip(doc);
      return;
    }
    scopeDismissTo(doc, container);

    el.innerHTML = formatValue(value, escapeHTML, 2, doc.baseURI);
    el.className = `vg-tooltip visible ${theme}-theme`;
    el.style.visibility = 'visible';
    // AFTER the content: writing innerHTML is what deletes the button on every show.
    const opener = lastPointerType(doc);
    decorateForOpener(el, opener, () => hideVegaTooltip(doc));

    const offset = offsetForOpener(opener, OFFSET);
    const viewport = doc.defaultView;
    const box = el.getBoundingClientRect();
    let x = event.clientX + offset;
    let y = event.clientY + offset;
    if (viewport && x + box.width > viewport.innerWidth) x = event.clientX - box.width - offset;
    if (viewport && y + box.height > viewport.innerHeight) y = event.clientY - box.height - offset;
    el.style.left = `${Math.max(0, x)}px`;
    el.style.top = `${Math.max(0, y)}px`;
  };
}

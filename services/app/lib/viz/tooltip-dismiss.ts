/**
 * The dismiss policy every chart tooltip CARD obeys. Browser-only, pure DOM, no React.
 *
 * A hover card is written for a mouse: Vega opens it when a pointer MOVES onto a mark and closes
 * it on the scenegraph's `mouseout`. A finger reliably produces neither.
 *
 * What was MEASURED here (headless Chromium, `hasTouch`, a real emulated tap on a mark — the
 * event log is in the phase report): `pointerdown → pointerup → pointerleave → touchend →
 * mousemove`, no `pointermove` at any point, and no card opened at all. What is REPORTED, from a
 * real device and NOT reproduced in this environment: a finger — which is never quite stationary
 * — does open the card, and it then stays up until a different mark is tapped. Treat the opening
 * half as the bug report's claim rather than as something this module's author watched happen.
 *
 * The dismissal half needs no such caveat, because the card that is up cannot be got rid of by
 * any means a phone has: it is `position: fixed` (it cannot scroll away) and `pointer-events:
 * none` (it cannot be tapped away). So the policy below is UNCONDITIONAL about how the card was
 * opened — it dismisses whatever is up, however it got there.
 *
 * It covers the ways a gesture can END that the hover model does not see: a touch that turned
 * into a scroll (`pointercancel`, `touchmove`), the page moving under the card (`scroll`), the
 * reader's attention going elsewhere (`pointerdown` outside the chart), and the keyboard's
 * universal exit (Escape). A mouse reader gets all of it too — "the page moved, so a thing
 * pinned to a viewport point is stale" is not a fact about fingers.
 *
 * The one touch-only part is the affordance: a card opened by touch carries a close button,
 * because a finger has no "move away" gesture and the tap-outside rule is invisible. A card
 * opened by a mouse gets none — desktop hover is unchanged.
 *
 * Listeners live on the chart's `ownerDocument`: charts render inside the story iframe, and an
 * iframe's events never reach the top document (see `lib/viz/iframe-event-bridge.ts`).
 */

/** How the card that is currently up was opened. */
export type TooltipOpener = 'mouse' | 'touch' | 'pen' | 'unknown';

/** Marks a tooltip card's own subtree, so the policy never dismisses on a tap INSIDE the card. */
const CARD_ATTR = 'data-mx-tooltip-card';
const CLOSE_CLASS = 'mx-tt-close';
const CLOSE_LABEL = 'Dismiss tooltip';

/** The floor on how far a touch-opened card sits from the finger, which covers what it taps. */
export const TOUCH_OFFSET = 34;

const lastPointer = new WeakMap<Document, TooltipOpener>();
const tracked = new WeakSet<Document>();

const asOpener = (pointerType: string | undefined): TooltipOpener =>
  pointerType === 'touch' || pointerType === 'pen' || pointerType === 'mouse' ? pointerType : 'unknown';

/**
 * Start remembering the pointer type of `doc`'s pointerdowns. Installed once per document, in
 * the CAPTURE phase so a chart that stops the event's propagation cannot blind it.
 */
function trackPointerType(doc: Document): void {
  if (tracked.has(doc)) return;
  tracked.add(doc);
  doc.addEventListener(
    'pointerdown',
    (e: Event) => lastPointer.set(doc, asOpener((e as PointerEvent).pointerType)),
    true,
  );
}

/** The pointerType of the last pointerdown seen in `doc` (tracked once per document). */
export function lastPointerType(doc: Document): TooltipOpener {
  trackPointerType(doc);
  return lastPointer.get(doc) ?? 'unknown';
}

/**
 * The gap between the pointer and the card. A cursor keeps the card's own `base` — desktop
 * placement is not this feature's business — while a finger gets at least `TOUCH_OFFSET`, so
 * the close button never lands under the finger that opened the card.
 */
export function offsetForOpener(opener: TooltipOpener, base: number): number {
  return opener === 'touch' || opener === 'pen' ? Math.max(base, TOUCH_OFFSET) : base;
}

const inside = (target: EventTarget | null, root: Element): boolean =>
  target instanceof Node && root.contains(target);

const inCard = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest(`[${CARD_ATTR}]`) != null;

/**
 * Install the dismiss policy for one card and return `release()`.
 *
 * Hides on `pointercancel` anywhere, on `scroll` (capture, so ANY scroller in the document
 * counts — scroll does not bubble), on `touchmove`/`pointerdown` outside `chart`, and on
 * Escape. A `pointerdown` inside the chart is how the next mark is picked, and one inside a
 * card is the close button being pressed; neither dismisses here.
 */
export function installTooltipDismiss(doc: Document, chart: Element, hide: () => void): () => void {
  trackPointerType(doc);

  const onCancel = () => hide();
  const onScroll = () => hide();
  const onKey = (e: Event) => { if ((e as KeyboardEvent).key === 'Escape') hide(); };
  const onOutside = (e: Event) => {
    if (inside(e.target, chart) || inCard(e.target)) return;
    hide();
  };

  doc.addEventListener('pointercancel', onCancel, true);
  doc.addEventListener('scroll', onScroll, true);
  doc.addEventListener('keydown', onKey, true);
  doc.addEventListener('pointerdown', onOutside, true);
  doc.addEventListener('touchmove', onOutside, true);

  return () => {
    doc.removeEventListener('pointercancel', onCancel, true);
    doc.removeEventListener('scroll', onScroll, true);
    doc.removeEventListener('keydown', onKey, true);
    doc.removeEventListener('pointerdown', onOutside, true);
    doc.removeEventListener('touchmove', onOutside, true);
  };
}

/**
 * Give a card opened by touch a close button; take it away from one opened by a mouse.
 *
 * Called AFTER the card's content is written — both cards set `innerHTML` on every show, which
 * would otherwise delete the button. The card itself keeps `pointer-events: none` (it must
 * never steal the hover it is describing); only the button subtree is tappable, styled in
 * `tooltip-styles.ts` — the only stylesheet that reaches the iframe document.
 */
export function decorateForOpener(el: HTMLElement, opener: TooltipOpener, hide: () => void): void {
  el.setAttribute(CARD_ATTR, '');
  const existing = el.querySelector(`.${CLOSE_CLASS}`);
  if (opener !== 'touch' && opener !== 'pen') {
    existing?.remove();
    return;
  }
  if (existing) return;
  const doc = el.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = CLOSE_CLASS;
  button.setAttribute('aria-label', CLOSE_LABEL);
  button.textContent = '×';
  button.addEventListener('click', (e) => { e.stopPropagation(); hide(); });
  el.appendChild(button);
}

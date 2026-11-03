/**
 * The hosted `@afbin/vega` View's default tooltip: a card painted with the page's design-system tokens instead of
 * Vega's fallback (the container's native `title` attribute: delayed, unthemed). Pure DOM, no globals at import.
 *
 * Vega calls a tooltip handler as `(sceneHandler, event, item, value)`, with a null value both when the pointer
 * leaves a mark and from `view.finalize()`. So the card and its document listeners exist only while it is up:
 * a null value removes both, which makes finalize the teardown. One card per view; it lives in the chart's own
 * document and is placed in viewport coordinates, flipped and clamped to stay on screen. Every field is written
 * with `textContent`, so values are never markup. The upstream `vega-tooltip` Handler is not used: it closes over
 * the global document, shares one `#vg-tooltip-element`, injects its own theme and never tears down.
 */
const STYLE_KEY = 'data-af-vega-tooltip-styles';
const CLASS = 'af-vega-tooltip';
const OFFSET = 12;
const EDGE = 4;

/** Tokens every design system sets in light and dark; system colors where a page has none. */
const tooltipStyles =
 `.${CLASS}{position:fixed;z-index:2147483000;pointer-events:none;box-sizing:border-box;` +
 `max-width:min(22rem,calc(100vw - 1rem));padding:.375rem .625rem;text-align:left;overflow-wrap:anywhere;` +
 `font:400 .75rem/1.45 var(--font-body,system-ui,sans-serif);` +
 `background:var(--popover,var(--background,Canvas));color:var(--popover-foreground,var(--foreground,CanvasText));` +
 `border:1px solid var(--border,GrayText);border-radius:var(--radius-md,calc(var(--radius,.625rem) - 2px));` +
 `box-shadow:var(--shadow-md,0 4px 6px -1px rgb(0 0 0 / 10%),0 2px 4px -2px rgb(0 0 0 / 10%))}` +
 `.${CLASS}-title{font-weight:600;margin-bottom:.25rem}` +
 `.${CLASS} table{border-collapse:collapse}.${CLASS} td{padding:1px 0;vertical-align:top}` +
 `.${CLASS} td.key{padding-right:.75rem;color:var(--muted-foreground,GrayText);white-space:nowrap}` +
 `.${CLASS} td.value{font-weight:600;font-variant-numeric:tabular-nums}`;

interface SceneHandler { element?(): Element | null }
type TooltipHandler = (this: unknown, handler: SceneHandler, event: MouseEvent | null, item: unknown, value: unknown) => void;

const text = (value: unknown): string => {
 if (value == null) return '';
 if (typeof value !== 'object') return String(value);
 try { return JSON.stringify(value); } catch { return String(value); }
};

function render(card: HTMLElement, value: unknown): void {
 const doc = card.ownerDocument;
 card.replaceChildren();
 if (!value || typeof value !== 'object' || Array.isArray(value)) {
  card.textContent = Array.isArray(value) ? value.map(text).join(', ') : text(value);
  return;
 }
 // Vega's tooltip convention: a `title` key is the card's heading.
 const {title, ...fields} = value as Record<string, unknown>;
 if (title != null && title !== '') {
  const heading = doc.createElement('div'); heading.className = `${CLASS}-title`; heading.textContent = text(title);
  card.append(heading);
 }
 const rows = Object.entries(fields).filter(([, field]) => field !== undefined);
 if (!rows.length) return;
 const table = doc.createElement('table');
 for (const [key, field] of rows) {
  const row = table.insertRow();
  const name = row.insertCell(); name.className = 'key'; name.textContent = key;
  const cell = row.insertCell(); cell.className = 'value'; cell.textContent = text(field);
 }
 card.append(table);
}

function place(card: HTMLElement, event: MouseEvent): void {
 const view = card.ownerDocument.defaultView;
 const {width, height} = card.getBoundingClientRect();
 const axis = (pointer: number, size: number, limit: number) => {
  const after = pointer + OFFSET;
  const start = after + size <= limit - EDGE ? after : pointer - OFFSET - size;
  return Math.max(EDGE, Math.min(start, limit - size - EDGE));
 };
 card.style.left = `${axis(event.clientX, width, view?.innerWidth ?? Infinity)}px`;
 card.style.top = `${axis(event.clientY, height, view?.innerHeight ?? Infinity)}px`;
}

function ensureStyles(doc: Document): void {
 if (doc.head.querySelector(`style[${STYLE_KEY}]`)) return;
 const style = doc.createElement('style'); style.setAttribute(STYLE_KEY, ''); style.textContent = tooltipStyles;
 doc.head.append(style);
}

/** Hide on Escape, a press outside the chart, leaving it, any scroll (the card is fixed) and a cancelled pointer. */
function dismissal(doc: Document, chart: Element, hide: () => void): () => void {
 const key = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
 const press = (event: Event) => { if (!(event.target instanceof Node && chart.contains(event.target))) hide(); };
 doc.addEventListener('keydown', key, true); doc.addEventListener('pointerdown', press, true);
 doc.addEventListener('scroll', hide, true); doc.addEventListener('pointercancel', hide, true);
 chart.addEventListener('pointerleave', hide);
 return () => {
  doc.removeEventListener('keydown', key, true); doc.removeEventListener('pointerdown', press, true);
  doc.removeEventListener('scroll', hide, true); doc.removeEventListener('pointercancel', hide, true);
  chart.removeEventListener('pointerleave', hide);
 };
}

/** A new themed tooltip handler for one view: `new View(runtime, {tooltip: tooltipHandler()})` or `view.tooltip(...)`. */
export function tooltipHandler(): TooltipHandler {
 let card: HTMLElement | undefined;
 let release: (() => void) | undefined;
 const hide = () => { release?.(); release = undefined; card?.remove(); card = undefined; };
 return function afVegaTooltip(handler, event, _item, value) {
  const chart = handler?.element?.();
  if (value == null || value === '' || !event || !chart) { hide(); return; }
  if (!card || card.ownerDocument !== chart.ownerDocument) {
   hide();
   const doc = chart.ownerDocument;
   ensureStyles(doc);
   card = doc.createElement('div'); card.className = CLASS; card.setAttribute('role', 'tooltip');
   (doc.fullscreenElement ?? doc.body).append(card);
   release = dismissal(doc, chart, hide);
  }
  render(card, value);
  place(card, event);
 };
}

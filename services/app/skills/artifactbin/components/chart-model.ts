/**
 * Internal: the engine-free decisions of af-chart: where its description comes from, the page's
 * design-system tokens as concrete sRGB (a 1x1 canvas resolves any colour syntax, oklch and
 * translucent tokens included, composited over the surface the chart sits on), which dimensions
 * the element supplies and the bounded table of the drawn values.
 * Used by: chart.ts, chart-render.ts.
 */
import type { ResolvedChartSpec } from '@/lib/viz/chart-plan';
import { houseTokens, mixColor, type ChartTokens } from '@/lib/viz/theme';

export type ChartRows = Record<string, unknown>[];
/** At most this many rows in the values table; a note says how many more were drawn. */
export const TABLE_ROWS = 50;
export const DEFAULT_HEIGHT = 320;

/** Re-set properties a page assigned before the element was defined, through its accessors. */
export function upgradeProperties(host: object, keys: readonly string[]): void {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(host, key)) continue;
    const value = (host as Record<string, unknown>)[key];
    delete (host as Record<string, unknown>)[key];
    (host as Record<string, unknown>)[key] = value;
  }
}

/** The `chart` property when set, else the text of a `<script type="application/json">` child. */
export function descriptionInput(host: Element, property: unknown): unknown {
  if (property !== undefined && property !== null) return property;
  const script = [...host.children].find(child => child.localName === 'script'
    && child.getAttribute('type') === 'application/json');
  return script ? script.textContent ?? '' : undefined;
}

const canvases = new WeakMap<Document, CanvasRenderingContext2D | null>();
const SENTINEL = '#010203';
/** `value` painted over `under` (opaque), read back as rgb(); null when it is no colour. */
function paint(doc: Document, value: string, under: string): string | null {
  if (!value) return null;
  if (!canvases.has(doc)) {
    let context: CanvasRenderingContext2D | null = null;
    try {
      context = doc.createElement('canvas').getContext('2d', { willReadFrequently: true });
    } catch { /* no canvas: hex and rgb() tokens only */ }
    canvases.set(doc, context);
  }
  const ctx = canvases.get(doc);
  if (!ctx) return /^(?:#[0-9a-f]{3,8}|rgba?\([^)]*\))$/i.test(value) ? value : null;
  ctx.fillStyle = SENTINEL;
  ctx.fillStyle = value;
  if (ctx.fillStyle === SENTINEL && value.toLowerCase() !== SENTINEL) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = under;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = value;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r},${g},${b})`;
}

/** The first painted background behind the element (a card, the page), or the page token. */
function surfaceBehind(host: Element, style: CSSStyleDeclaration): string {
  const view = host.ownerDocument.defaultView!;
  for (let node = host.parentElement; node; node = node.parentElement) {
    const color = view.getComputedStyle(node).backgroundColor;
    if (color && color !== 'transparent' && !/^rgba\(.*,\s*0\)$/.test(color)) return color;
  }
  return style.getPropertyValue('--background').trim();
}

/** Whether the page reads dark: its `data-af-dark`, else the reader's colour scheme. */
export function prefersDark(doc: Document): boolean {
  const flag = doc.documentElement.getAttribute('data-af-dark');
  if (flag !== null) return flag === 'true';
  return doc.defaultView?.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/** The chart's colours and font from the tokens in scope at the element; house ones where unset. */
export function readTokens(host: Element): ChartTokens {
  const doc = host.ownerDocument, style = doc.defaultView!.getComputedStyle(host);
  const dark = prefersDark(doc), house = houseTokens(dark ? 'dark' : 'light');
  const token = (name: string) => style.getPropertyValue(name).trim();
  const surface = paint(doc, surfaceBehind(host, style), dark ? '#000' : '#fff') ?? house.surface;
  const color = (name: string, fallback: string) => paint(doc, token(name), surface) ?? fallback;
  const category = [1, 2, 3, 4, 5].map(n => paint(doc, token(`--chart-${n}`), surface))
    .filter((value): value is string => value !== null);
  const muted = color('--muted-foreground', house.muted), border = color('--border', house.border);
  // A design system names five chart colours; more series take them again toward the text colour,
  // then toward the surface, so no two of fifteen series share one.
  const base = category.length ? category : house.category;
  const ink = color('--foreground', house.foreground);
  return {
    category: category.length ? [...base, ...base.map(c => mixColor(c, ink, 0.4)),
      ...base.map(c => mixColor(c, surface, 0.45))] : house.category,
    foreground: ink, muted,
    subtle: mixColor(muted, surface, 0.35), border, grid: mixColor(surface, border, 0.6), surface,
    font: token('--font-body') || style.fontFamily || house.font,
  };
}

const COMPOSED = ['hconcat', 'vconcat', 'concat', 'repeat', 'facet'];
/** The dimensions the element supplies: a spec's own number, or a composed layout, keeps its. */
export function slotOf(resolved: ResolvedChartSpec, width: number, height: number) {
  const spec = resolved.spec;
  const composed = resolved.engine === 'vega-lite' && COMPOSED.some(key => key in spec);
  return {
    width: composed || typeof spec.width === 'number' ? undefined : width,
    height: composed || typeof spec.height === 'number' ? undefined : height,
    facet: resolved.engine === 'vega-lite' && 'facet' in spec,
  };
}
export type ChartSlot = ReturnType<typeof slotOf>;

/** The `height` attribute in pixels, else the default. */
export function heightOf(host: Element): number {
  const value = Number(host.getAttribute('height'));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : DEFAULT_HEIGHT;
}

/** The accessible name: the `label` attribute, else the spec's description or title. */
export function labelOf(host: Element, spec: Record<string, unknown> | null): string {
  const title = spec?.title as unknown;
  const text = typeof title === 'string' ? title
    : typeof (title as { text?: unknown })?.text === 'string' ? (title as { text: string }).text
    : null;
  return host.getAttribute('label')
    ?? (typeof spec?.description === 'string' ? spec.description : null) ?? text ?? 'Chart';
}

const shown = (value: unknown): string =>
  value == null ? '' : typeof value === 'number' ? value.toLocaleString()
    : typeof value === 'object' ? JSON.stringify(value) : String(value);

/** The drawn rows as a table, the first TABLE_ROWS of them, with a note when there are more. */
export function valuesTable(doc: Document, rows: ChartRows, columns: readonly string[]): Node[] {
  const table = doc.createElement('table'), head = table.createTHead().insertRow();
  for (const column of columns) {
    const th = doc.createElement('th');
    th.scope = 'col';
    th.textContent = column;
    head.append(th);
  }
  const body = table.createTBody();
  for (const row of rows.slice(0, TABLE_ROWS)) {
    const tr = body.insertRow();
    for (const column of columns) {
      const cell = tr.insertCell(), value = row[column];
      cell.textContent = shown(value);
      if (typeof value === 'number') cell.className = 'af-chart-number';
    }
  }
  const scroll = doc.createElement('div');
  scroll.className = 'af-chart-scroll';
  scroll.append(table);
  if (rows.length <= TABLE_ROWS) return [scroll];
  const note = doc.createElement('p');
  note.textContent = `First ${TABLE_ROWS} of ${rows.length.toLocaleString()} rows.`;
  return [scroll, note];
}

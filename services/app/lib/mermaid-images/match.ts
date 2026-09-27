/**
 * WHEN A STORED DRAWING STANDS IN FOR THE ENGINE'S — the one decision rule,
 * pure, shared by the reader's component (components/kit/mermaid) and the
 * server (lib/mermaid-images/store, the reader routes). No imports: it runs in
 * both.
 *
 * Mermaid lays a drawing out by measuring its labels in the page (SVG text
 * boxes, `getBBox`), so a browser draws the same code identically only when
 * its palette AND those measurements agree. Measured on one web-font document
 * (lib/mermaid-images/__tests__/match has the numbers):
 *
 *   - Blink on macOS and Blink on Linux with unhinted text agree to 1/64px:
 *     the same font file gives the same advances once nothing rounds them.
 *   - Blink on Linux by default HINTS: every advance is rounded to a whole
 *     pixel, so its boxes are 4–39px off over the probe and every drawing is
 *     laid out differently. The harvest therefore runs unhinted (services/browser).
 *   - WebKit agrees on widths to 2dp but draws a shorter line box (19.36px, not
 *     20px), and its drawings come out 2.5–4px shorter; Gecko's boxes are
 *     wider than its advances. Neither can use a Blink drawing.
 *   - A system font (or a character no web face covers) resolves per machine.
 *
 * So the READER keeps a stored drawing only when its palette key is the same
 * and every measurement is within a sub-pixel tolerance of the harvest's
 * (`storedDrawingFits`). Whether a reader CAN pass that check depends on its
 * platform, the face and the size (Blink on macOS agrees with the harvest for
 * Inter at 16px but not at 14px), so the SERVER offers a stored drawing only
 * where a measured table says so (lib/mermaid-images/readers); everyone else is
 * served the engine's page exactly as before, so a reader downloads a drawing
 * and the engine both only when its browser has moved since the table was
 * measured — and even then never shows a drawing that is not its own.
 */

/**
 * What Mermaid measures of a palette, in this order: the SVG text box (width,
 * height, y) of the label face at the label size, then of the edge-label face
 * at 11px, over a fixed Latin probe plus the diagram's own other characters.
 */
export type MermaidMetrics = readonly [number, number, number, number, number, number];

/**
 * How far two measurements may differ and still lay a drawing out the same.
 * Widths sum ~100 advances: unhinted Linux vs macOS differ by 0.016px there,
 * the nearest wrong reader (Gecko, hinted Linux) by 4px and more. Heights and
 * offsets are line-box metrics a platform either shares exactly or does not
 * (WebKit is 0.64px off).
 */
const WIDTH_TOLERANCE_PX = 0.1;
const BOX_TOLERANCE_PX = 0.01;
const METRIC_LIMIT = 100_000;

/** The Latin a label is made of; the diagram's own other characters are measured beside it. */
export const METRICS_PROBE = 'The quick brown fox jumps over the lazy dog 0123456789 THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG';

export function parseMermaidMetrics(text: string | null | undefined): MermaidMetrics | null {
  if (typeof text !== 'string' || text.length > 256) return null;
  const parts = text.split(',');
  if (parts.length !== 6 || parts.some((part) => !/^-?\d+(\.\d+)?(e-?\d+)?$/i.test(part.trim()))) return null;
  const values = parts.map(Number);
  return values.every((value) => Number.isFinite(value) && Math.abs(value) < METRIC_LIMIT) ? values as unknown as MermaidMetrics : null;
}

export function formatMermaidMetrics(metrics: MermaidMetrics): string {
  return metrics.join(',');
}

const asMetrics = (value: readonly number[] | null | undefined): MermaidMetrics | null =>
  Array.isArray(value) ? parseMermaidMetrics(value.join(',')) : null;

/** One face's text box — width, height, y — as two browsers measured it: the same layout, up to sub-pixel noise? */
export function mermaidBoxesAgree(a: readonly number[], b: readonly number[]): boolean {
  return a.length === 3 && b.length === 3 && a.every((value, i) => Math.abs(value - b[i]!) <= (i === 0 ? WIDTH_TOLERANCE_PX : BOX_TOLERANCE_PX));
}

/** Do two browsers' measurements lay a drawing out the same (up to invisible, sub-pixel differences)? */
export function mermaidMetricsAgree(a: MermaidMetrics | null, b: MermaidMetrics | null): boolean {
  if (!a || !b) return a === b;
  return mermaidBoxesAgree(a.slice(0, 3), b.slice(0, 3)) && mermaidBoxesAgree(a.slice(3), b.slice(3));
}

/**
 * THE READER'S RULE: keep the stored drawing only when this browser would draw
 * the same thing — the same palette key, and faces that measure the same. A
 * browser that cannot measure SVG text (no layout) agrees only with a drawing
 * that carries no measurements, which the harvest never stores.
 */
export function storedDrawingFits(stored: { palette: string; metrics?: readonly number[] }, reader: { palette: string; metrics: MermaidMetrics | null }): boolean {
  if (stored.palette !== reader.palette) return false;
  const measured = stored.metrics === undefined ? null : asMetrics(stored.metrics);
  if (stored.metrics !== undefined && !measured) return false;
  return mermaidMetricsAgree(measured, reader.metrics);
}

/**
 * The faces a drawing was drawn in — the label face (the first family of the
 * host's stack) at the label size, and the edge-label face (at 11px) — as the
 * harvest records them: what the server looks up in its measured table of
 * readers (lib/mermaid-images/readers).
 */
export interface MermaidFaces { label: string; size: number; edge: string }

const FAMILY = /^[\w .-]{1,64}$/;

export function formatMermaidFaces(faces: MermaidFaces): string {
  return `${faces.label}|${faces.size}|${faces.edge}`;
}

export function parseMermaidFaces(text: string | null | undefined): MermaidFaces | null {
  if (typeof text !== 'string') return null;
  const [label, size, edge, ...rest] = text.split('|');
  if (rest.length || !label || !edge || !FAMILY.test(label) || !FAMILY.test(edge) || !/^\d{1,3}$/.test(size ?? '')) return null;
  return { label, size: Number(size), edge };
}

/** Metrics as stored (a JSON array), when they are six finite measurements. */
export function storedMermaidMetrics(value: readonly number[] | null | undefined): MermaidMetrics | null {
  return asMetrics(value);
}

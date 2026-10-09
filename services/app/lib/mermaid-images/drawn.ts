/**
 * WHAT A DRAWING WAS DRAWN UNDER — the attributes the kit's engine sets on a
 * figure it drew and the harvest reads
 * (lib/publish/assets/mermaid-harvester). Pure: it runs in both.
 *
 *   - `data-mx-mermaid-metrics`: the SVG text boxes (width, height, y) of the
 *     label face at the label size and of the edge-label face at 11px over
 *     METRICS_PROBE — what Mermaid measures a label with. The kit compares
 *     them before and after drawing (a face that landed mid-draw leaves no
 *     telling which it was laid out in); the harvest refuses whole-pixel widths,
 *     the mark of a browser that hinted text.
 *   - `data-mx-mermaid-faces`: the faces the drawing is in — the first family
 *     of the label stack at its size, and of the edge-label stack — which the
 *     harvest embeds (lib/mermaid-images/fonts).
 */

/** The Latin a label is made of; the diagram's own other characters are measured beside it. */
export const METRICS_PROBE = 'The quick brown fox jumps over the lazy dog 0123456789 THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG';

/** Label face (width, height, y) then edge-label face (width, height, y). */
export type MermaidMetrics = readonly [number, number, number, number, number, number];

const METRIC_LIMIT = 100_000;

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

/** The faces a drawing is drawn in: the label face at its size, and the edge-label face. */
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

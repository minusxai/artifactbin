/**
 * When is a chart's specification the SAME specification?
 *
 * A document is re-parsed on every edit, so the envelope handed to the chart is
 * a new object every time — even when the chart is untouched. Keyed on object
 * identity, a chart therefore tears its view down and builds a new one whenever
 * anything anywhere in the document changes: the reader watches an agent fix a
 * typo three paragraphs up and the chart flickers, re-animates and loses its
 * zoom.
 *
 * The answer is a VALUE signature. Cheap enough to compute per render (a spec
 * is small), and exact: two specs with the same content are the same chart.
 *
 * Key order is normalised, because an object rebuilt from a re-parse can carry
 * its keys in a different order without meaning anything different.
 */

/** A stable, order-insensitive signature of any JSON-shaped value. */
export function specSignature(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, normalize(v)]));
  }
  // NaN and Infinity are not JSON; name them so two of them compare equal
  // rather than both collapsing to null.
  if (typeof value === 'number' && !Number.isFinite(value)) return `#${String(value)}`;
  return value;
}

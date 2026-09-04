/**
 * A SPARKLINE'S DRAWING RULES, as a pure string function — the half of
 * `components/ui` Spark that the document kit also needs.
 *
 * The server renders one 96x20 spline per series (lib/viz/sparkline, headless
 * vega) and every surface that shows it stretches that one render to its own
 * box. Three transformations make that work, and they were written once, inside
 * an app-chrome component:
 *
 *  - the fixed pixel size becomes a `viewBox` + `preserveAspectRatio="none"`,
 *    so ONE render serves the shelf's full-width hero line, a table cell and a
 *    12px phone mark with no second vega pass;
 *  - every `<path>` gets a NON-SCALING stroke, because the stretch is wide but
 *    never tall and a stroke otherwise scales with the geometry it rides (the
 *    spike's near-vertical segments drew ~5x fatter than the flat baseline);
 *  - `filled: false` zeroes the area fill for a line-only reading.
 *
 * They live here because `<Files>` — a folder's listing, which is DOCUMENT kit
 * — draws the same mark, and `lib/__tests__/reader-bundle-hygiene` forbids the
 * kit reaching into app chrome. So this module imports nothing and knows no
 * React: it is markup in, markup out, and both callers inject the answer.
 *
 * THE ANSWER IS ALWAYS ONE `<svg data-sparkline>` ELEMENT. That is the one
 * thing this adds to what `Spark` did: a caller that reserved space for a
 * picture can then find the picture it drew — and a value that is not a
 * rendered spline draws an EMPTY one rather than being injected. It matters
 * here in a way it never did on the shelf: the shelf's splines come from the
 * dashboard's own query, while a folder's come from the DOCUMENT's `<Query>`,
 * which its author writes.
 *
 * Guarded by lib/viz/__tests__/spark-markup.test.ts.
 */

/** The empty picture: the element, and nothing drawn in it. */
const EMPTY = '<svg data-sparkline="" preserveAspectRatio="none"></svg>';

const SVG_OPEN = /^\s*<svg([^>]*)>/;

/** A server-rendered spline (lib/viz/sparkline), made fluid, stamped, and safe to inject. */
export function sparklineSvg(spark: string, { filled = true }: { filled?: boolean } = {}): string {
  const open = spark.match(SVG_OPEN);
  if (!open) return EMPTY;
  let attrs = ` data-sparkline=""${open[1]}`;
  const width = open[1].match(/\swidth="([\d.]+)"/)?.[1];
  const height = open[1].match(/\sheight="([\d.]+)"/)?.[1];
  if (!/\sviewBox=/.test(attrs) && width && height) attrs += ` viewBox="0 0 ${width} ${height}"`;
  if (!/\spreserveAspectRatio=/.test(attrs)) attrs += ' preserveAspectRatio="none"';
  const body = spark.slice(open[0].length);
  // One screen thickness at every size, and only where the source did not
  // already say so.
  const uniform = body.replace(/<path\b(?![^>]*\svector-effect=)/g, '<path vector-effect="non-scaling-stroke" ');
  const drawn = filled ? uniform : uniform.replace(/(<path\b[^>]*\sfill-opacity=)"[^"]*"/g, '$1"0"');
  return `<svg${attrs}>${drawn}`;
}

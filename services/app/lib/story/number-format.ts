/**
 * Number format specs, in ONE place — the publish door asks "is this valid",
 * every renderer asks "format this", and neither can throw.
 *
 * A spec is author input (`<Number format>`, `<DataTable columns[].fmt>`,
 * `singleValueConfig.format`), in d3-format's grammar. An agent guesses that
 * grammar — Pi wrote `",0"` on production for ",.0f" — and d3's parser THROWS
 * on a guess. Publish accepted it, and the throw landed inside SSR: every
 * render of that document (page, raw, export) was a 500 until this existed.
 * So the door refuses a bad spec by name, and a renderer that meets one
 * anyway — a document published before the door checked — falls back to the
 * default format rather than taking the document down.
 */
import { format as d3format } from 'd3-format';

/** What to write instead, for the publish error. */
export const NUMBER_FORMAT_HINT = 'a d3-format spec — e.g. ",.0f" (thousands, no decimals), "$,.2f", ".1%"';

const DEFAULT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const cache = new Map<string, ((n: number) => string) | null>();

function compile(spec: string): ((n: number) => string) | null {
  if (!cache.has(spec)) {
    try { cache.set(spec, d3format(spec)); } catch { cache.set(spec, null); }
  }
  return cache.get(spec) ?? null;
}

/** True for an absent/empty spec (the default format) or one d3 parses. */
export function isNumberFormat(spec: string | undefined): boolean {
  return !spec || compile(spec) !== null;
}

/** d3 for a valid spec, the default format otherwise. Never throws. */
export function numberFormatter(spec: string | undefined): (n: number) => string {
  const f = spec ? compile(spec) : null;
  return f ? (n) => { try { return f(n); } catch { return DEFAULT.format(n); } } : (n) => DEFAULT.format(n);
}

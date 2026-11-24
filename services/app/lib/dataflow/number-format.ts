/** Number format specs come from authors. Renderers fall back to the default when d3 cannot use a spec. */
import { format as d3format } from 'd3-format';

const DEFAULT = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const cache = new Map<string, ((n: number) => string) | null>();

function compile(spec: string): ((n: number) => string) | null {
  if (!cache.has(spec)) {
    try { cache.set(spec, d3format(spec)); } catch { cache.set(spec, null); }
  }
  return cache.get(spec) ?? null;
}

/** d3 for a valid spec, the default format otherwise. Never throws. */
export function numberFormatter(spec: string | undefined): (n: number) => string {
  const f = spec ? compile(spec) : null;
  return f ? (n) => { try { return f(n); } catch { return DEFAULT.format(n); } } : (n) => DEFAULT.format(n);
}

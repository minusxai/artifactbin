/**
 * Chart color tokens: the shadcn `--chart-1..5` CSS variables drive the
 * Vega categorical color range. Resolved from COMPUTED style at render time, so a chart picks
 * up whatever `[data-theme]` scope (or `:root` default block) surrounds its container — no
 * theme plumbing through the embed chain. Outside a token scope (dashboards, questions) the
 * vars are undefined and the house palette stays in charge (`chartTokenRange` → null).
 */

const CHART_TOKEN_NAMES = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5'] as const;

const OKLCH_RE = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*(?:\/\s*[\d.%]+\s*)?\)$/i;

/**
 * `oklch(L C H)` → sRGB hex (CSS Color 4 matrices, gamut-clamped). The design
 * themes declare `--chart-1..5` in oklch, and `getComputedStyle` hands the
 * string back VERBATIM (custom properties are never color-resolved). Canvas
 * can paint an oklch fill, so plain marks looked fine — but a recipe that
 * computes with the scale color (`rgb(scale('color', …))`, the trend card's
 * history-fade gradient) goes through vega's d3-color, which cannot parse
 * oklch: every stop became rgba(NaN,…) and the sparkline rendered BLACK on
 * every theme. Convert at the token boundary and both worlds agree.
 */
function oklchToHex(value: string): string {
  const m = OKLCH_RE.exec(value);
  if (!m) return value;
  const L = m[1].endsWith('%') ? parseFloat(m[1]) / 100 : parseFloat(m[1]);
  const C = parseFloat(m[2]);
  const H = (parseFloat(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(H);
  const b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const lin = [
    +4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.7076147010 * s,
  ];
  const hex = lin.map((c) => {
    const clamped = Math.min(1, Math.max(0, c));
    const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * clamped ** (1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, gamma)) * 255).toString(16).padStart(2, '0');
  });
  return `#${hex.join('')}`;
}

/**
 * Map the five chart tokens to a Vega categorical range. Pure (testable): `read` returns a
 * custom property's computed value ('' when undefined). Returns null unless `--chart-1` is
 * defined (no token scope → keep the default palette); otherwise the defined tokens in order,
 * skipping any empty slots — oklch values converted to hex (see oklchToHex).
 */
export function chartTokenRange(read: (name: string) => string): string[] | null {
  const values = CHART_TOKEN_NAMES.map(n => (read(n) ?? '').trim());
  if (!values[0]) return null;
  return values.filter(v => v !== '').map(oklchToHex);
}

/** DOM wrapper: resolve the chart tokens from an element's computed style (its own document's view). */
export function chartTokenRangeFromElement(el: Element): string[] | null {
  const win = el.ownerDocument?.defaultView;
  if (!win) return null;
  const cs = win.getComputedStyle(el);
  return chartTokenRange(name => cs.getPropertyValue(name));
}

/** An exact CSS custom-property reference — the only string form the resolver touches. */
const CSS_VAR_RE = /^var\((--[A-Za-z0-9-]+)\)$/;

/**
 * Resolve `var(--token)` color references IN PLACE throughout a built spec —
 * the theme-following form of a recipe color param (`trendColor:
 * "var(--foreground)"`). Runs at the same seam and cadence as the chart-token
 * range (per chart build, from the container's computed style), which is what
 * makes a var-form color follow theme AND mode switches where a raw hex is a
 * deliberate pin. oklch values convert at the boundary for the same d3-color
 * reason as the token range; an undefined token falls back to a visible
 * neutral rather than handing vega an unparseable string.
 */
export function resolveCssVarColors(node: unknown, read: (name: string) => string): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => {
      const m = typeof item === 'string' ? CSS_VAR_RE.exec(item) : null;
      if (m) node[i] = resolveOne(m[1], read);
      else resolveCssVarColors(item, read);
    });
    return;
  }
  if (!node || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const value = record[key];
    const m = typeof value === 'string' ? CSS_VAR_RE.exec(value) : null;
    if (m) record[key] = resolveOne(m[1], read);
    else resolveCssVarColors(value, read);
  }
}

function resolveOne(name: string, read: (n: string) => string): string {
  const value = (read(name) ?? '').trim();
  return value === '' ? '#888888' : oklchToHex(value);
}

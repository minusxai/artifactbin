/**
 * CSS colour values → concrete sRGB, engine-free and dependency-free: what the query image does
 * to a design system's tokens before Vega and librsvg see them (neither resolves `var()`,
 * `oklch()` or `color-mix()`). Understood: `#rgb[a]`/`#rrggbb[aa]`, `rgb[a]()`, `hsl[a]()`,
 * `oklch()`, `oklab()`, `color-mix(in srgb|oklab|oklch, A [p%], B [q%])`, `transparent`, `black`,
 * `white`, and `var(--name[, fallback])` through the caller's lookup (at most 16 deep). Anything
 * else is null, never a guess. Out-of-gamut values clamp per channel.
 */

/** Gamma-encoded sRGB channels and alpha, each in 0..1. */
type Rgba = [number, number, number, number];
export type CssVariables = (name: string) => string | null | undefined;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const toLinear = (c: number) => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const fromLinear = (c: number) => c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;

function toOklab([r, g, b]: Rgba): [number, number, number] {
  const [lr, lg, lb] = [r, g, b].map(toLinear) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function fromOklab(L: number, a: number, b: number, alpha: number): Rgba {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return [...rgb.map(c => clamp(fromLinear(c))), clamp(alpha)] as Rgba;
}
const toOklch = (c: Rgba): [number, number, number] => {
  const [L, a, b] = toOklab(c);
  return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360];
};
const fromOklch = (L: number, C: number, H: number, alpha: number) =>
  fromOklab(L, C * Math.cos(H * Math.PI / 180), C * Math.sin(H * Math.PI / 180), alpha);

/** Split on `sep` outside parentheses, dropping empty parts. */
function splitTop(text: string, sep: RegExp): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (depth === 0 && sep.test(ch)) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map(s => s.trim()).filter(Boolean);
}

/** A numeric component: `n`, `n%` (of `percent`), `none` (0); NaN when it is neither. */
function num(token: string | undefined, percent = 1): number {
  if (token === undefined) return NaN;
  if (token === 'none') return 0;
  if (token.endsWith('%')) return parseFloat(token) / 100 * percent;
  if (/deg$/.test(token)) return parseFloat(token);
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(token) ? parseFloat(token) : NaN;
}
/** `a b c [/ alpha]` or `a, b, c[, alpha]` → four tokens (alpha may be undefined). */
function components(args: string): [string, string, string, string | undefined] | null {
  const [main, slash] = splitTop(args, /\//);
  const parts = splitTop(main ?? '', /[\s,]/);
  const alpha = slash ?? parts[3];
  return parts.length === 3 || (parts.length === 4 && slash === undefined)
    ? [parts[0]!, parts[1]!, parts[2]!, alpha] : null;
}
const alphaOf = (token: string | undefined) => token === undefined ? 1 : clamp(num(token, 1));

function hsl(h: number, s: number, l: number, a: number): Rgba {
  const f = (n: number) => {
    const k = (n + h / 30) % 12, t = s * Math.min(l, 1 - l);
    return l - t * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4), a];
}

function mix(space: string, a: Rgba, b: Rgba, t: number): Rgba | null {
  const alpha = a[3] + (b[3] - a[3]) * t;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  if (space === 'srgb') return [lerp(a[0], b[0]), lerp(a[1], b[1]), lerp(a[2], b[2]), alpha];
  if (space === 'oklab') {
    const x = toOklab(a), y = toOklab(b);
    return fromOklab(lerp(x[0], y[0]), lerp(x[1], y[1]), lerp(x[2], y[2]), alpha);
  }
  if (space === 'oklch') {
    const x = toOklch(a), y = toOklch(b);
    let dh = y[2] - x[2];
    if (dh > 180) dh -= 360; else if (dh < -180) dh += 360;
    return fromOklch(lerp(x[0], y[0]), lerp(x[1], y[1]), x[2] + dh * t, alpha);
  }
  return null;
}

const NAMED: Record<string, Rgba> = { transparent: [0, 0, 0, 0], black: [0, 0, 0, 1], white: [1, 1, 1, 1] };

function parse(value: string, vars: CssVariables, depth: number): Rgba | null {
  const text = value.trim().toLowerCase();
  if (depth > 16 || !text) return null;
  const fn = /^([a-z-]+)\(([\s\S]*)\)$/.exec(text);
  if (fn) {
    const [, name, args] = fn as unknown as [string, string, string];
    if (name === 'var') {
      const [ref, ...fallback] = splitTop(args, /,/);
      const found = ref ? vars(ref.trim()) : null;
      if (found != null && found.trim()) return parse(found, vars, depth + 1);
      return fallback.length ? parse(fallback.join(','), vars, depth + 1) : null;
    }
    if (name === 'color-mix') {
      const [space, first, second] = splitTop(args, /,/);
      const m = /^in\s+(srgb|oklab|oklch)$/.exec(space ?? '');
      if (!m || !first || !second) return null;
      const part = (s: string) => {
        const p = /\s(\d+\.?\d*)%$/.exec(s);
        return { color: parse(p ? s.slice(0, p.index) : s, vars, depth + 1), p: p ? Number(p[1]) / 100 : null };
      };
      const x = part(first), y = part(second);
      if (!x.color || !y.color) return null;
      const px = x.p ?? (y.p == null ? 0.5 : 1 - y.p), py = y.p ?? 1 - px;
      return px + py > 0 ? mix(m[1]!, x.color, y.color, py / (px + py)) : null;
    }
    const c = components(args);
    if (!c) return null;
    const out: Rgba | null =
      name === 'rgb' || name === 'rgba' ? [num(c[0], 255) / 255, num(c[1], 255) / 255, num(c[2], 255) / 255, alphaOf(c[3])]
        : name === 'hsl' || name === 'hsla' ? hsl(((num(c[0]) % 360) + 360) % 360, clamp(num(c[1].endsWith('%') ? c[1] : c[1] + '%')), clamp(num(c[2].endsWith('%') ? c[2] : c[2] + '%')), alphaOf(c[3]))
          : name === 'oklch' ? fromOklch(num(c[0], 1), num(c[1], 0.4), num(c[2]), alphaOf(c[3]))
            : name === 'oklab' ? fromOklab(num(c[0], 1), num(c[1], 0.4), num(c[2], 0.4), alphaOf(c[3]))
              : null;
    return out && out.every(Number.isFinite) ? out.map((v, i) => i < 3 ? clamp(v) : v) as Rgba : null;
  }
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(text)?.[1];
  if (hex) {
    const full = hex.length <= 4 ? [...hex].map(x => x + x).join('') : hex;
    const ch = [0, 2, 4, 6].map(i => i < full.length ? parseInt(full.slice(i, i + 2), 16) / 255 : 1);
    return ch as Rgba;
  }
  return NAMED[text] ?? null;
}

const hex2 = (v: number) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0');

/**
 * A CSS colour value as `#rrggbb`, a translucent one composited over `over` (itself resolved,
 * default white); null when the value is not a colour this module understands.
 */
export function resolveCssColor(value: string, vars: CssVariables = () => null, over = '#ffffff'): string | null {
  const c = parse(value, vars, 0);
  if (!c) return null;
  const base = c[3] >= 1 ? c : (parse(over, vars, 0) ?? [1, 1, 1, 1]);
  const [r, g, b] = c[3] >= 1 ? c : [0, 1, 2].map(i => c[i]! * c[3] + base[i]! * (1 - c[3]));
  return `#${hex2(r!)}${hex2(g!)}${hex2(b!)}`;
}

/**
 * Selected text must stay READABLE — everywhere a ::selection rule ships.
 *
 * The failure this pins down: a theme repurposing its button pair
 * (`background: var(--primary); color: var(--primary-foreground)`) for
 * ::selection. White-on-brand-color is designed for LARGE button labels;
 * as a selection wash over body text it measured 2.7–3.8:1 (pop light,
 * modernist dark, the app's own light theme) — under WCAG AA's 4.5:1 and
 * genuinely hard to read. The translucent tint the other themes use
 * (`color-mix(primary N%, transparent)`, text keeps its own color) passes
 * comfortably in both modes, so that is the pattern this test enforces the
 * RESULT of — any implementation is fine as long as the measured contrast
 * clears AA in light and dark.
 *
 * Colors are resolved the way a browser would: oklch → sRGB, translucent
 * selection backgrounds alpha-composited over the theme's page background,
 * WCAG relative luminance on the result.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STORY_THEMES } from '@/lib/data/story/story-themes';

const AA = 4.5;

// ── color math ──────────────────────────────────────────────────────────────

type Rgb = [number, number, number]; // linear-light sRGB, 0..1

function oklchToLinearSrgb(L: number, C: number, H: number): Rgb {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const rgb: Rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return rgb.map((v) => Math.min(1, Math.max(0, v))) as Rgb;
}

const gamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
const degamma = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

function parseColor(value: string): Rgb {
  const ok = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value.trim());
  if (ok) return oklchToLinearSrgb(Number(ok[1]), Number(ok[2]), Number(ok[3]));
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => degamma(v / 255)) as Rgb;
  }
  throw new Error(`unparseable color: ${value}`);
}

/** Alpha-composite fg over bg in GAMMA sRGB space — what a browser paints. */
function composite(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const f = fg.map(gamma), b = bg.map(gamma);
  return f.map((v, i) => degamma(v * alpha + b[i] * (1 - alpha))) as Rgb;
}

const luminance = ([r, g, b]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function contrast(c1: Rgb, c2: Rgb): number {
  const [hi, lo] = [luminance(c1), luminance(c2)].sort((a, b) => b - a);
  return (hi + 0.05) / (lo + 0.05);
}

// ── the ::selection declaration, resolved per palette ───────────────────────

interface SelectionRule { background: string; color?: string }

function selectionRule(css: string): SelectionRule | null {
  const m = /::selection\s*\{([^}]*)\}/.exec(css);
  if (!m) return null;
  const decls = Object.fromEntries(
    m[1].split(';').map((d) => d.split(':').map((s) => s.trim())).filter((p) => p.length === 2),
  ) as Record<string, string>;
  if (!decls.background) throw new Error(`::selection without background in: ${m[1]}`);
  return { background: decls.background, color: decls.color };
}

/** Resolve a declaration value against a palette: var() lookup, color-mix over transparent. */
function measure(rule: SelectionRule, vars: Record<string, string>, pageBg: string): { bg: Rgb; text: Rgb } {
  const resolve = (v: string): string => {
    const m = /^var\((--[\w-]+)\)$/.exec(v.trim());
    if (!m) return v.trim();
    const got = vars[m[1]];
    if (!got) throw new Error(`undefined ${m[1]}`);
    return got;
  };
  const page = parseColor(resolve(pageBg));
  let bg: Rgb;
  const mix = /^color-mix\(in\s+[\w-]+\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/.exec(rule.background);
  if (mix) {
    bg = composite(parseColor(resolve(mix[1])), Number(mix[2]) / 100, page);
  } else {
    bg = parseColor(resolve(rule.background));
  }
  const text = parseColor(resolve(rule.color ?? 'var(--foreground)'));
  return { bg, text };
}

// ── the assertions ──────────────────────────────────────────────────────────

describe('::selection contrast (WCAG AA, both modes)', () => {
  for (const theme of STORY_THEMES) {
    const rule = theme.css ? selectionRule(theme.css) : null;
    if (!rule) continue;
    it(`theme "${theme.name}" keeps selected text ≥ ${AA}:1 in light and dark`, () => {
      for (const [mode, vars] of [['light', theme.cssVars], ['dark', theme.darkCssVars]] as const) {
        const { bg, text } = measure(rule, vars, 'var(--background)');
        const ratio = contrast(text, bg);
        expect(ratio, `${theme.name} ${mode}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
      }
    });
  }

  it('the app shell keeps selected text ≥ 4.5:1 in both of its themes', () => {
    const css = readFileSync(join(process.cwd(), 'app', 'globals.css'), 'utf8');
    const rule = selectionRule(css);
    expect(rule, 'globals.css must keep a ::selection rule').not.toBeNull();

    // The two palettes, read from the file so a token change re-measures here.
    const block = (re: RegExp) => {
      const m = re.exec(css);
      if (!m) throw new Error(`palette block not found: ${re}`);
      return Object.fromEntries(
        [...m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((v) => [v[1], v[2].trim()]),
      ) as Record<string, string>;
    };
    // LIGHT is the default and sits on bare `:root` (the @theme block) —
    // whichever mode is default must be, since that is what a reader gets
    // before any script runs. Dark is the [data-theme] override on top.
    const light = block(/@theme\s*\{([^}]*)\}/);
    const dark = { ...light, ...block(/:root\[data-theme='dark'\]\s*\{([^}]*)\}/) };

    for (const [mode, vars] of [['dark', dark], ['light', light]] as const) {
      const named = {
        '--background': vars['--color-bg'],
        '--foreground': vars['--color-fg'],
        ...vars,
      };
      const { bg, text } = measure(rule!, named, 'var(--color-bg)');
      const ratio = contrast(text, bg);
      expect(ratio, `app ${mode}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA);
    }
  });
});

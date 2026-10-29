/**
 * Internal: options, pose easing and per-path SVG paint for af-isometric.
 * Used by: isometric.ts.
 */
import type { IsometricSpec } from "../jsx";
import type { IsoDrawPath } from "../story-ui";
export interface IsometricOptions extends Omit<
  IsometricSpec,
  "spread" | "angle" | "flow"
> {
  spread?: number;
  angle?: number;
  flow?: boolean;
}
export interface IsometricPose {
  spread: number;
  angle: number;
}
export function isometricTarget(options: IsometricOptions): IsometricPose {
  const clamp = (value: number | undefined, low: number, high: number) =>
    Math.min(high, Math.max(low, Number.isFinite(value) ? value! : 0));
  return {
    spread: clamp(options.spread, 0, 1),
    angle: clamp(options.angle, -180, 180),
  };
}
export function advanceIsometric(
  from: IsometricPose,
  to: IsometricPose,
  seconds: number,
  smooth: boolean,
): IsometricPose {
  const amount = smooth
    ? 1 - Math.exp(-12 * Math.max(0, Math.min(seconds, 0.05)))
    : 1;
  const next = {
    spread: from.spread + (to.spread - from.spread) * amount,
    angle: from.angle + (to.angle - from.angle) * amount,
  };
  return Math.abs(next.spread - to.spread) <= 0.0001 &&
    Math.abs(next.angle - to.angle) <= 0.001
    ? to
    : next;
}
const ink = "var(--ds-hand-ink, var(--foreground, #172033))";
const ground = "var(--ds-hand-ground, var(--card, white))";
const tones = {
  neutral: ground,
  accent: "var(--ds-hand-fill, var(--primary, #4263eb))",
  secondary: "var(--ds-hand-fill2, var(--chart-2, #0d9488))",
  muted: "var(--ds-hand-muted, var(--muted, #cbd5e1))",
};
/** SVG attributes for one drawn path; outline mode tints fills, solid keeps full tone. */
export function isometricPathAttributes(
  path: IsoDrawPath,
  p: IsometricOptions,
  dash: number,
): Record<string, string | number> {
  const tone = tones[path.tone];
  const base =
    p.appearance === "solid" || path.section || path.tone === "neutral"
      ? tone
      : `color-mix(in srgb, ${tone} 18%, ${ground})`;
  // Faces darken by their shade (lighting); edges and creases stay unfilled.
  const fill =
    path.kind === "face"
      ? `color-mix(in srgb, ${ink} ${path.shade * (p.appearance === "solid" ? 5 : 2)}%, ` +
        `${base})`
      : "none";
  const stroke =
    path.kind === "face"
      ? fill
      : path.tone === "muted"
        ? `color-mix(in srgb, ${ink} 48%, ${ground})`
        : path.tone !== "neutral"
          ? `color-mix(in srgb, ${tone} 80%, ${ink})`
          : ink;
  return {
    d: path.d,
    fill,
    stroke,
    "stroke-width":
      path.width ?? (path.kind === "face" ? 0.35 : path.kind === "crease" ? 0.8 : 1.6),
    "stroke-opacity": path.opacity ?? (path.kind === "crease" ? 0.7 : 1),
    "vector-effect": "non-scaling-stroke",
    // Flow animates the dash offset; see AfIsometric.tick.
    "stroke-dasharray": path.dashed ? "10 10" : "none",
    "stroke-dashoffset": path.dashed ? dash : 0,
  };
}

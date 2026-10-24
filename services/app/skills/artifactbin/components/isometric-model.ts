import type { IsometricSpec } from "../jsx/isometric-spec";
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

/** Geometry only: no DOM, theme, animation engine or external assets. */
import { roundedPlan, circleRing, iso, pathOf, extrude, fitProjection } from './isometric-core.mjs';
import type { IsometricPart, IsometricSpec, IsoPoint, IsoPlanPoint } from '@/lib/jsx/isometric-spec';

const ring = (p: Exclude<IsometricPart, { kind: 'line' }>): IsoPlanPoint[] => p.kind === 'prism' ? p.points : p.kind === 'cylinder'
  ? circleRing(p.x, p.y, p.radius, 40) as IsoPlanPoint[]
  : roundedPlan({ x: p.x, y: p.y, w: p.width, d: p.depth, r: p.radius ?? 0 }, 6) as IsoPlanPoint[];
const shift = ([x, y, z]: IsoPoint, separation: IsoPoint, spread: number): IsoPoint => [x + separation[0] * spread, y + separation[1] * spread, z + separation[2] * spread];
const zero: IsoPoint = [0, 0, 0];

export function isometricScene(spec: IsometricSpec) {
  const width = spec.width ?? 640, height = spec.height ?? 400;
  const shapes = spec.parts.map(part => ({ part, outline: part.kind === 'line' ? null : ring(part) }));
  const bounds: IsoPoint[] = [];
  for (const { part, outline } of shapes) {
    const points: IsoPoint[] = part.kind === 'line' ? part.points : outline!.flatMap(([x, y]): IsoPoint[] => [[x, y, part.z], [x, y, part.z + part.height]]);
    for (const p of points) bounds.push(p, shift(p, part.separation ?? zero, 1));
  }
  const projection = fitProjection(bounds, width, height, { pad: Math.min(24, width / 10, height / 10), azimuth: spec.azimuth ?? 45, elevation: spec.elevation ?? 30 });
  return { width, height, projection, draw(spread = 0) {
    const amount = Number.isFinite(spread) ? Math.max(0, Math.min(1, spread)) : 0;
    return shapes.map(({ part, outline }) => {
      const delta = (part.separation ?? zero).map(n => n * amount);
      if (part.kind === 'line') return { key: part.key, tone: part.tone ?? 'neutral', dashed: part.dashed, line: pathOf(part.points.map(p => iso(shift(p, part.separation ?? zero, amount), projection))), solid: null };
      const shifted = outline!.map(([x, y]) => [x + delta[0]!, y + delta[1]!]);
      const solid = extrude(shifted, part.z + delta[2]!, part.height, projection, { convex: part.kind !== 'prism' });
      return { key: part.key, tone: part.tone ?? 'neutral', dashed: false, line: null, solid };
    });
  } };
}

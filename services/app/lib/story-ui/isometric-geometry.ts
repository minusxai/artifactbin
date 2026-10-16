import type { IsometricShape, IsoPlanPoint, IsoPoint } from '@/lib/jsx/isometric-spec';

export type Projection = {
  right: IsoPoint;
  up: IsoPoint;
  viewer: IsoPlanPoint;
  scale: number;
  offset: IsoPlanPoint;
};
const dot = (a: IsoPoint, b: IsoPoint) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const radians = (degrees: number) => degrees * Math.PI / 180;

/** One orthographic camera, fitted once over all poses so interaction cannot change the zoom. */
export function fitAssembly(points: IsoPoint[], width: number, height: number, azimuth: number, elevation: number): Projection {
  const a = radians(azimuth), e = radians(elevation);
  const right: IsoPoint = [Math.sin(a), -Math.cos(a), 0];
  const up: IsoPoint = [-Math.cos(a) * Math.sin(e), -Math.sin(a) * Math.sin(e), Math.cos(e)];
  const projected = points.map(p => [dot(p, right), -dot(p, up)] as IsoPlanPoint);
  const min: IsoPlanPoint = [Infinity, Infinity], max: IsoPlanPoint = [-Infinity, -Infinity];
  for (const [x, y] of projected) {
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y);
  }
  const inset = Math.min(24, width / 10, height / 10);
  const scale = Math.min((width - inset * 2) / Math.max(max[0] - min[0], 1e-6), (height - inset * 2) / Math.max(max[1] - min[1], 1e-6));
  return { right, up, viewer: [Math.cos(a), Math.sin(a)], scale,
    offset: [(width - (max[0] + min[0]) * scale) / 2, (height - (max[1] + min[1]) * scale) / 2] };
}

export function projectPoint(point: IsoPoint, camera: Projection): IsoPlanPoint {
  return [camera.offset[0] + dot(point, camera.right) * camera.scale, camera.offset[1] - dot(point, camera.up) * camera.scale];
}

export function svgPath(points: IsoPlanPoint[], close = false): string {
  return points.map(([x, y], i) => `${i ? 'L' : 'M'}${Number(x.toFixed(2))} ${Number(y.toFixed(2))}`).join('') + (close ? 'Z' : '');
}

/** Canonical winding and start make an author's clockwise/counterclockwise outlines equivalent. */
function canonical(points: IsoPlanPoint[]): IsoPlanPoint[] {
  const area = points.reduce((sum, p, i) => {
    const next = points[(i + 1) % points.length]!;
    return sum + p[0] * next[1] - next[0] * p[1];
  }, 0);
  const ordered = area < 0 ? [...points].reverse() : [...points];
  let first = 0;
  for (let i = 1; i < ordered.length; i++) {
    const p = ordered[i]!, best = ordered[first]!;
    if (p[0] < best[0] || (p[0] === best[0] && p[1] < best[1])) first = i;
  }
  return [...ordered.slice(first), ...ordered.slice(0, first)];
}

export function partOutline(part: Extract<IsometricShape, { kind: 'slab' | 'cylinder' | 'prism' }>): IsoPlanPoint[] {
  if (part.kind === 'prism') return canonical(part.points);
  if (part.kind === 'cylinder') return Array.from({ length: 48 }, (_, i) => {
    const angle = i * Math.PI / 24;
    return [part.x + Math.cos(angle) * part.radius, part.y + Math.sin(angle) * part.radius];
  });
  const { x, y, width: w, depth: d } = part;
  const r = Math.min(part.radius ?? 0, w / 2, d / 2);
  if (!r) return [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
  const centres: IsoPlanPoint[] = [[x + w - r, y + r], [x + w - r, y + d - r], [x + r, y + d - r], [x + r, y + r]];
  return centres.flatMap(([cx, cy], quadrant) => Array.from({ length: 9 }, (_, step): IsoPlanPoint => {
    const angle = (quadrant - 1 + step / 8) * Math.PI / 2;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }));
}

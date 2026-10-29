/** Hidden-line removal for projected illustrations. Clip lines at face boundaries before stroking. */
import type { IsoPoint, IsoPlanPoint } from '@/lib/jsx';
import { projectPoint, svgPath, type Projection } from './isometric-geometry';
import { add, sub, mul, dot, cross, unit, type ShapeGeometry } from './isometric-mesh';
const cross2 = (a: IsoPlanPoint, b: IsoPlanPoint) => a[0] * b[1] - a[1] * b[0];
const sub2 = (a: IsoPlanPoint, b: IsoPlanPoint): IsoPlanPoint => [a[0] - b[0], a[1] - b[1]];
const bounds = (points: IsoPlanPoint[]) => ({ minX: Math.min(...points.map(p => p[0])), maxX: Math.max(...points.map(p => p[0])), minY: Math.min(...points.map(p => p[1])), maxY: Math.max(...points.map(p => p[1])) });
const inside = ([x, y]: IsoPlanPoint, polygon: IsoPlanPoint[]) => {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!, b = polygon[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
};
export function visibleLinework(mesh: ShapeGeometry, camera: Projection, viewer: IsoPoint) {
  const faces = mesh.faces.flatMap(face => {
    const n = unit(cross(sub(face.vertices[1]!, face.vertices[0]!), sub(face.vertices[2]!, face.vertices[0]!)));
    const facing = dot(n, viewer);
    if (facing < 1e-8) return [];
    const polygon = face.vertices.map(p => projectPoint(p, camera));
    return [{ n, facing, origin: face.vertices[0]!, polygon, box: bounds(polygon) }];
  });
  // A bounded 16×16 index avoids comparing every stroke against every surface in detailed scenes.
  const extent = faces.length ? bounds(faces.flatMap(f => [[f.box.minX, f.box.minY], [f.box.maxX, f.box.maxY]] as IsoPlanPoint[])) : { minX: 0, maxX: 1, minY: 0, maxY: 1 };
  const cellX = Math.max(1, (extent.maxX - extent.minX) / 16), cellY = Math.max(1, (extent.maxY - extent.minY) / 16);
  const cells = (box: ReturnType<typeof bounds>) => {
    const result: number[] = [];
    const x = (v: number) => Math.min(15, Math.max(0, Math.floor((v - extent.minX) / cellX)));
    const y = (v: number) => Math.min(15, Math.max(0, Math.floor((v - extent.minY) / cellY)));
    for (let i = x(box.minX); i <= x(box.maxX); i++) for (let j = y(box.minY); j <= y(box.maxY); j++) result.push(i * 16 + j);
    return result;
  };
  const bins = new Map<number, Set<number>>();
  faces.forEach((face, i) => cells(face.box).forEach(cell => { if (!bins.has(cell)) bins.set(cell, new Set()); bins.get(cell)!.add(i); }));
  return (vertices: IsoPoint[]): string => {
    if (!faces.length) return svgPath(vertices.map(v => projectPoint(v, camera)));
    let d = '', last: IsoPlanPoint | null = null;
    for (let i = 0; i < vertices.length - 1; i++) {
      const a = vertices[i]!, b = vertices[i + 1]!, pa = projectPoint(a, camera), pb = projectPoint(b, camera), delta = sub2(pb, pa);
      const box = bounds([pa, pb]);
      const candidates = [...new Set(cells(box).flatMap(cell => [...(bins.get(cell) ?? [])]))].map(i => faces[i]!).filter(f => f.box.minX <= box.maxX && f.box.maxX >= box.minX && f.box.minY <= box.maxY && f.box.maxY >= box.minY);
      const breaks = [0, 1];
      for (const face of candidates) for (let j = 0; j < face.polygon.length; j++) {
        const p = face.polygon[j]!, edge = sub2(face.polygon[(j + 1) % face.polygon.length]!, p), det = cross2(delta, edge);
        if (Math.abs(det) < 1e-9) continue;
        const q = sub2(p, pa), t = cross2(q, edge) / det, u = cross2(q, delta) / det;
        if (t > 1e-7 && t < 1 - 1e-7 && u >= 0 && u <= 1) breaks.push(t);
      }
      breaks.sort((x, y) => x - y);
      for (let j = 0; j < breaks.length - 1; j++) {
        const lo = breaks[j]!, hi = breaks[j + 1]!;
        if (hi - lo < 1e-7) continue;
        const point = add(a, mul(sub(b, a), (lo + hi) / 2)), projected = projectPoint(point, camera);
        const hidden = candidates.some(f => dot(f.n, sub(f.origin, point)) / f.facing > 1e-5 && inside(projected, f.polygon));
        if (hidden) { last = null; continue; }
        const start = projectPoint(add(a, mul(sub(b, a), lo)), camera), end = projectPoint(add(a, mul(sub(b, a), hi)), camera);
        const segment = svgPath([start, end]);
        d += last && Math.hypot(last[0] - start[0], last[1] - start[1]) < 1e-5 ? segment.slice(segment.indexOf('L')) : segment;
        last = end;
      }
    }
    return d;
  };
}

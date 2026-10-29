/** Projects a compact assembly once; controls translate cached paths or rotate only moving meshes. */
import type { IsometricSpec, IsoPoint, IsoPlanPoint, IsoTone, IsometricPart } from '@/lib/jsx/isometric-spec';
import { visibleLinework } from './isometric-visibility';
import { projectPoint, svgPath, fitAssembly, type Projection } from './isometric-geometry';
import { shapeGeometry, add, sub, mul, dot, cross, unit, rotate, type ShapeGeometry } from './isometric-mesh';
export type IsoDrawPath = { d: string; kind: 'face' | 'outline' | 'crease' | 'line'; tone: IsoTone; shade: number; dashed?: boolean; section?: boolean; width?: number; opacity?: number };
const zero: IsoPoint = [0, 0, 0];
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : 0));
const normal = (vertices: IsoPoint[]) => unit(cross(sub(vertices[1]!, vertices[0]!), sub(vertices[2]!, vertices[0]!)));
const centre = (vertices: IsoPoint[]) => mul(vertices.reduce(add, zero), 1 / vertices.length);

/** Include the exact projected extrema of each vertex's circular motion, not just endpoint poses. */
function envelope(point: IsoPoint, rotation: IsometricPart['rotation'], azimuth: number, elevation: number): IsoPoint[] {
  if (!rotation) return [point];
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  const directions: IsoPoint[] = [[Math.sin(a), -Math.cos(a), 0], [-Math.cos(a) * Math.sin(e), -Math.sin(a) * Math.sin(e), Math.cos(e)]];
  const [lo, hi] = rotation.range ?? [-15, 15];
  const n = unit(rotation.axis), v = sub(point, rotation.origin), u = sub(v, mul(n, dot(n, v))), w = cross(n, v);
  const angles = [lo, hi];
  for (const direction of directions) {
    const peak = Math.atan2(dot(w, direction), dot(u, direction)) * 180 / Math.PI;
    for (let k = -2; k <= 2; k++) { const angle = peak + k * 180; if (angle > lo && angle < hi) angles.push(angle); }
  }
  return angles.map(angle => rotate(point, rotation.origin, rotation.axis, angle));
}
function pathsFor(mesh: ShapeGeometry, camera: Projection, viewer: IsoPoint): IsoDrawPath[] {
  const depth = (vertices: IsoPoint[]) => dot(centre(vertices), viewer);
  const visible = visibleLinework(mesh, camera, viewer);
  const paths: Array<IsoDrawPath & { depth: number }> = [];
  const edges = new Map<string, { a: IsoPoint; b: IsoPoint; normals: IsoPoint[]; tone: IsoTone }>();
  const key = (p: IsoPoint) => p.map(n => n.toFixed(5)).join(',');
  for (const face of mesh.faces) {
    const n = normal(face.vertices);
    if (dot(n, viewer) > -1e-8) paths.push({ d: svgPath(face.vertices.map(p => projectPoint(p, camera)), true), kind: 'face', tone: face.tone, section: face.section,
      shade: Math.round((1 - Math.abs(dot(n, unit([-.5, -.2, 1])))) * 4), depth: depth(face.vertices) });
    face.vertices.forEach((a, i) => {
      const b = face.vertices[(i + 1) % face.vertices.length]!, id = [key(a), key(b)].sort().join('|');
      const existing = edges.get(id);
      if (existing) existing.normals.push(n); else edges.set(id, { a, b, normals: [n], tone: face.tone });
    });
  }
  for (const { a, b, normals, tone } of edges.values()) {
    const front = normals.filter(n => dot(n, viewer) > 1e-8);
    if (!front.length) continue;
    const silhouette = front.length !== normals.length || normals.length === 1;
    const crease = front.length > 1 && front.some(n => dot(n, front[0]!) < .85);
    if (silhouette || crease) paths.push({ d: visible([a, b]), kind: silhouette ? 'outline' : 'crease', tone, shade: 0, depth: Infinity });
  }
  for (const line of mesh.lines) {
    const projected = line.vertices.map(p => projectPoint(p, camera));
    let d = visible(line.vertices);
    if (line.arrow && projected.length > 1) {
      const tip = projected[projected.length - 1]!, previous = projected[projected.length - 2]!;
      const dx = tip[0] - previous[0], dy = tip[1] - previous[1], length = Math.hypot(dx, dy) || 1;
      d += svgPath([[tip[0] - dx / length * 9 + dy / length * 4, tip[1] - dy / length * 9 - dx / length * 4], tip,
        [tip[0] - dx / length * 9 - dy / length * 4, tip[1] - dy / length * 9 + dx / length * 4]]);
    }
    paths.push({ d, kind: 'line', tone: line.tone, shade: 0, dashed: line.dashed, width: line.width, opacity: line.opacity, depth: Infinity });
  }
  return paths.sort((a, b) => a.depth - b.depth).map(({ depth: _depth, ...path }) => path);
}
export function isometricScene(spec: IsometricSpec) {
  const width = spec.width ?? 640, height = spec.height ?? 400, azimuth = spec.azimuth ?? 45, elevation = spec.elevation ?? 30;
  const meshes = spec.parts.map(part => {
    const shapes = part.kind === 'group' ? part.parts : [part];
    const pieces = shapes.map(shape => shapeGeometry(shape, part.tone));
    return { part, mesh: { faces: pieces.flatMap(p => p.faces), lines: pieces.flatMap(p => p.lines) } };
  });
  const bounds: IsoPoint[] = [];
  for (const { part, mesh } of meshes) {
    const points = [...mesh.faces, ...mesh.lines].flatMap(p => p.vertices);
    for (const point of points) for (const p of envelope(point, part.rotation, azimuth, elevation)) bounds.push(p, add(p, part.separation ?? zero));
  }
  const projection = fitAssembly(bounds, width, height, azimuth, elevation);
  const a = azimuth * Math.PI / 180, e = elevation * Math.PI / 180;
  const viewer: IsoPoint = [Math.cos(a) * Math.cos(e), Math.sin(a) * Math.cos(e), Math.sin(e)];
  const cached = meshes.map(({ part, mesh }) => ({ part, mesh, angle: NaN, paths: [] as IsoDrawPath[] }));
  return { width, height, projection, draw(spread = 0, angle = 0) {
    const amount = clamp(spread, 0, 1);
    return cached.map(item => {
      const { part, mesh } = item, rotation = part.rotation;
      const degrees = rotation ? clamp(angle, ...(rotation.range ?? [-15, 15]) as [number, number]) : 0;
      if (degrees !== item.angle) {
        const transform = (vertices: IsoPoint[]) => rotation ? vertices.map(p => rotate(p, rotation.origin, rotation.axis, degrees)) : vertices;
        item.paths = pathsFor({ faces: mesh.faces.map(f => ({ ...f, vertices: transform(f.vertices) })), lines: mesh.lines.map(l => ({ ...l, vertices: transform(l.vertices) })) }, projection, viewer);
        item.angle = degrees;
      }
      const origin = projectPoint(zero, projection), moved = projectPoint(mul(part.separation ?? zero, amount), projection);
      const offset: IsoPlanPoint = [moved[0] - origin[0], moved[1] - origin[1]];
      return { key: part.key, paths: item.paths, offset };
    });
  } };
}

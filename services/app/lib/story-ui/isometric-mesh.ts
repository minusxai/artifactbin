/** Shape construction only. Authored specs never contain generated vertices or executable code. */
import type { IsometricShape, IsoPoint, IsoTone } from '@/lib/jsx/isometric-spec';
import { partOutline } from './isometric-geometry';
export const add = (a: IsoPoint, b: IsoPoint): IsoPoint => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: IsoPoint, b: IsoPoint): IsoPoint => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a: IsoPoint, n: number): IsoPoint => [a[0] * n, a[1] * n, a[2] * n];
export const dot = (a: IsoPoint, b: IsoPoint) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: IsoPoint, b: IsoPoint): IsoPoint => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const unit = (a: IsoPoint) => mul(a, 1 / (Math.hypot(...a) || 1));
const frame = (axis: IsoPoint) => {
  const w = unit(axis), u = unit(cross(Math.abs(w[2]) < .8 ? [0, 0, 1] : [0, 1, 0], w));
  return [u, cross(w, u), w] as const;
};
type MeshFace = { vertices: IsoPoint[]; tone: IsoTone; section?: boolean };
type MeshLine = { vertices: IsoPoint[]; tone: IsoTone; dashed?: boolean; arrow?: boolean; width?: number; opacity?: number };
export type ShapeGeometry = { faces: MeshFace[]; lines: MeshLine[] };
function curvePoints(points: IsoPoint[], steps: number): IsoPoint[] {
  const [a, b, c, d] = points as [IsoPoint, IsoPoint, IsoPoint, IsoPoint];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps, s = 1 - t;
    return add(add(mul(a, s ** 3), mul(b, 3 * s * s * t)), add(mul(c, 3 * s * t * t), mul(d, t ** 3)));
  });
}
export function shapeGeometry(shape: IsometricShape, inherited: IsoTone = 'neutral'): ShapeGeometry {
  const tone = shape.tone ?? inherited;
  const faces: MeshFace[] = [], lines: MeshLine[] = [];
  const face = (vertices: IsoPoint[], section = false) => {
    // Collapsed revolution poles are triangles, not degenerate quads.
    const clean = vertices.filter((v, i) => Math.hypot(...sub(v, vertices[(i + vertices.length - 1) % vertices.length]!)) > 1e-9);
    if (clean.length >= 3) faces.push({ vertices: clean, tone, section });
  };
  if (shape.kind === 'line') {
    lines.push({ vertices: shape.curve ? curvePoints(shape.points, 32) : shape.points, tone, dashed: shape.dashed, arrow: shape.arrow, width: shape.width, opacity: shape.opacity });
  } else if (shape.kind === 'revolve') {
    const [u, v, w] = frame(shape.axis ?? [0, 0, 1]), segments = shape.segments ?? 32;
    const at = ([r, h]: [number, number], i: number) => add(shape.origin, add(mul(w, h), add(mul(u, r * Math.cos(i * 2 * Math.PI / segments)), mul(v, r * Math.sin(i * 2 * Math.PI / segments)))));
    for (let j = 0; j < shape.profile.length - 1; j++) for (let i = 0; i < segments; i++) {
      face([at(shape.profile[j]!, i), at(shape.profile[j]!, i + 1), at(shape.profile[j + 1]!, i + 1), at(shape.profile[j + 1]!, i)]);
    }
  } else if (shape.kind === 'sweep') {
    const points = shape.curve ? curvePoints(shape.points, shape.steps ?? 24) : shape.points;
    const sides = shape.segments ?? 12;
    let previous: IsoPoint | undefined;
    const rings = points.map((point, i) => {
      const tangent = unit(sub(points[Math.min(i + 1, points.length - 1)]!, points[Math.max(0, i - 1)]!));
      let u = previous ? unit(sub(previous, mul(tangent, dot(previous, tangent)))) : frame(tangent)[0];
      if (Math.hypot(...u) < .1) u = frame(tangent)[0];
      previous = u;
      const v = cross(tangent, u);
      return Array.from({ length: sides }, (_, n) => add(point, add(mul(u, shape.radius * Math.cos(n * 2 * Math.PI / sides)), mul(v, shape.radius * Math.sin(n * 2 * Math.PI / sides)))));
    });
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) face([rings[i]![j]!, rings[i]![(j + 1) % sides]!, rings[i + 1]![(j + 1) % sides]!, rings[i + 1]![j]!]);
    face([...rings[0]!].reverse()); face(rings[rings.length - 1]!);
  } else {
    const outline = partOutline(shape);
    const floor = outline.map(([x, y]): IsoPoint => [x, y, shape.z]);
    const roof = outline.map(([x, y]): IsoPoint => [x, y, shape.z + shape.height]);
    face([...floor].reverse(), shape.kind === 'prism' && shape.section); face(roof, shape.kind === 'prism' && shape.section);
    floor.forEach((p, i) => { const j = (i + 1) % floor.length; face([p, floor[j]!, roof[j]!, roof[i]!]); });
  }
  const transform = (v: IsoPoint, copy: number) => {
    const o = shape.orientation;
    const oriented = o ? rotate(v, o.origin ?? [0, 0, 0], o.axis, o.degrees) : v;
    const r = shape.repeat?.rotation;
    const repeated = r ? rotate(oriented, r.origin ?? [0, 0, 0], r.axis, r.degrees * copy) : oriented;
    return add(repeated, mul(shape.repeat?.step ?? [0, 0, 0], copy));
  };
  const copies = Array.from({ length: shape.repeat?.count ?? 1 }, (_, i) => i);
  return { faces: copies.flatMap(i => faces.map(f => ({ ...f, vertices: f.vertices.map(v => transform(v, i)) }))),
    lines: copies.flatMap(i => lines.map(l => ({ ...l, vertices: l.vertices.map(v => transform(v, i)) }))) };
}
/** Rodrigues rotation, shared by arbitrary axes and the angle-controlled assembly. */
export function rotate(point: IsoPoint, origin: IsoPoint, axis: IsoPoint, degrees: number): IsoPoint {
  const v = sub(point, origin), n = unit(axis), a = degrees * Math.PI / 180;
  return add(origin, add(add(mul(v, Math.cos(a)), mul(cross(n, v), Math.sin(a))), mul(n, dot(n, v) * (1 - Math.cos(a)))));
}

import { describe, expect, it } from 'vitest';
import { isometricScene } from '../isometric';
import { shapeGeometry } from '../isometric-mesh';
import type { IsometricPart, IsometricShape } from '@/lib/jsx/isometric-spec';
const parts: IsometricPart[] = [
  { key: 'plate', kind: 'slab', x: -50, y: -30, z: 0, width: 100, depth: 60, height: 8, radius: 5 },
  { key: 'shaft', kind: 'cylinder', x: 0, y: 0, z: 8, radius: 8, height: 40, separation: [0, 0, 50] },
  { key: 'profile', kind: 'prism', points: [[-20, -10], [20, 0], [-20, 10]], z: 48, height: 4 },
  { key: 'axis', kind: 'line', points: [[0, 0, 0], [0, 0, 100]], dashed: true },
];
const cup: IsometricShape = { key: 'cup', kind: 'revolve', origin: [0, 0, 0], profile: [[0, 0], [10, 0], [14, 30], [12, 30], [8, 3], [0, 3]], segments: 24 };
describe('isometric geometry', () => {
  it('draws finite paths inside a camera fitted over both poses', () => {
    const scene = isometricScene({ title: 'Assembly', parts });
    for (const amount of [0, 0.5, 1]) {
      const drawings = scene.draw(amount);
      expect(drawings.map(p => p.key)).toEqual(parts.map(p => p.key));
      for (const part of drawings) for (const path of part.paths) {
        expect(path.d).not.toMatch(/NaN|Infinity/);
        const numbers = path.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
        numbers.forEach((n, i) => {
          const moved = n + part.offset[i % 2]!;
          expect(moved).toBeGreaterThanOrEqual(23.8);
          expect(moved).toBeLessThanOrEqual((i % 2 ? scene.height : scene.width) - 23.8);
        });
      }
    }
  });
  it('moves an assembly without regenerating paths or changing fixed parts', () => {
    const scene = isometricScene({ title: 'Assembly', parts });
    const a = scene.draw(0), b = scene.draw(1);
    expect(a[0]).toEqual(b[0]);
    expect(a[1]!.offset).not.toEqual(b[1]!.offset);
    expect(a[1]!.paths).toBe(b[1]!.paths);
    expect(a[2]).toEqual(b[2]);
    expect(scene.draw(-1)).toEqual(a);
    expect(scene.draw(2)).toEqual(b);
  });
  it('fits a vertical line without division by zero', () => {
    const scene = isometricScene({ title: 'Axis', parts: [parts[3]!] });
    expect(scene.draw()[0]!.paths[0]!.d).not.toMatch(/NaN|Infinity/);
  });
  it('draws the same concave extrusion for either winding and any starting vertex', () => {
    const points: [number, number][] = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]];
    const draw = (outline: [number, number][]) => isometricScene({ title: 'Bracket', parts: [
      { key: 'bracket', kind: 'prism', points: outline, z: 0, height: 12 },
    ] }).draw();
    expect(draw([...points].reverse())).toEqual(draw(points));
    expect(draw([...points.slice(2), ...points.slice(0, 2)])).toEqual(draw(points));
  });
  it('revolves a wall section with an open mouth and real inner wall', () => {
    const { faces } = shapeGeometry(cup);
    const rim = faces.filter(f => f.vertices.every(v => v[2] === 30));
    expect(rim).toHaveLength(24);
    expect(rim.every(f => f.vertices.every(v => Math.hypot(v[0], v[1]) >= 11.99))).toBe(true);
    expect(faces.some(f => f.vertices.some(v => v[2] === 3 && Math.abs(Math.hypot(v[0], v[1]) - 8) < 1e-8))).toBe(true);
  });
  it('sweeps a cubic pipe with a consistent radius and finite frames at vertical tangents', () => {
    const { faces } = shapeGeometry({ key: 'pipe', kind: 'sweep', points: [[0, 0, 0], [0, 0, 20], [20, 0, 20], [20, 0, 0]], curve: 'bezier', radius: 2, steps: 16, segments: 12 });
    expect(faces).toHaveLength(194); // 16 rings of quads plus two end caps
    expect(faces.flatMap(f => f.vertices).flat().every(Number.isFinite)).toBe(true);
    expect(faces[0]!.vertices.slice(0, 2).every(v => Math.abs(Math.hypot(...v) - 2) < 1e-8)).toBe(true);
  });
  it('repeats a radial detail without expanding the authored spec', () => {
    const mesh = shapeGeometry({ key: 'ticks', kind: 'line', points: [[8, 0, 1], [10, 0, 1]], repeat: { count: 4, rotation: { axis: [0, 0, 1], degrees: 90 } } });
    expect(mesh.lines).toHaveLength(4);
    expect(mesh.lines[1]!.vertices[1]![0]).toBeCloseTo(0);
    expect(mesh.lines[1]!.vertices[1]![1]).toBeCloseTo(10);
    expect(mesh.lines[2]!.vertices[1]![0]).toBeCloseTo(-10);
  });
  it('clips a rear line at an occluding solid while retaining its exposed ends', () => {
    const scene = isometricScene({ title: 'Hidden line', azimuth: 90, elevation: 30, parts: [{ key: 'assembly', kind: 'group', parts: [
      { key: 'block', kind: 'slab', x: -5, y: -5, z: 0, width: 10, depth: 10, height: 10 },
      { key: 'behind', kind: 'line', points: [[-20, -8, 5], [20, -8, 5]] },
    ] }] });
    const line = scene.draw()[0]!.paths.find(p => p.kind === 'line')!;
    expect(line.d.match(/M/g)).toHaveLength(2);
  });
  it('rotates only the actuated assembly and keeps a fixed camera across the declared range', () => {
    const scene = isometricScene({ title: 'Wing', parts: [parts[0]!, {
      key: 'wing', kind: 'group', rotation: { axis: [0, 1, 0], origin: [0, 0, 40], range: [-4, 10] },
      parts: [{ key: 'foil', kind: 'prism', points: [[-20, -4], [50, 0], [-20, 4]], z: 40, height: 10 }],
    }] });
    const low = scene.draw(0, -4), high = scene.draw(0, 10);
    expect(low[0]).toEqual(high[0]);
    expect(low[1]!.paths).not.toEqual(high[1]!.paths);
    expect(scene.draw(0, 90)).toEqual(high);
    for (const part of [...low, ...high]) for (const p of part.paths) {
      const values = p.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
      values.forEach(v => expect(v).toBeGreaterThanOrEqual(15));
      values.forEach((v, i) => expect(v).toBeLessThanOrEqual((i % 2 ? scene.height : scene.width) - 15));
    }
  });
  it('keeps grouped shapes together, shades them and omits smooth tessellation edges', () => {
    const scene = isometricScene({ title: 'Cup assembly', parts: [{ key: 'assembly', kind: 'group', parts: [cup], separation: [10, 20, 30] }] });
    const a = scene.draw(0)[0]!, b = scene.draw(1)[0]!;
    expect(a.key).toBe('assembly');
    expect(a.paths).toBe(b.paths);
    expect(a.offset).not.toEqual(b.offset);
    const edges = a.paths.filter(p => p.kind !== 'face');
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.length).toBeLessThan(a.paths.filter(p => p.kind === 'face').length * 2);
  });
});

import { describe, expect, it } from 'vitest';
import { isometricScene } from '../isometric';
import type { IsometricPart } from '@/lib/jsx/isometric-spec';
const parts: IsometricPart[] = [
  { key: 'plate', kind: 'slab', x: -50, y: -30, z: 0, width: 100, depth: 60, height: 8, radius: 5 },
  { key: 'shaft', kind: 'cylinder', x: 0, y: 0, z: 8, radius: 8, height: 40, separation: [0, 0, 50] },
  { key: 'profile', kind: 'prism', points: [[-20, -10], [20, 0], [-20, 10]], z: 48, height: 4 },
  { key: 'axis', kind: 'line', points: [[0, 0, 0], [0, 0, 100]], dashed: true },
];
describe('isometric geometry', () => {
  it('draws finite solid faces and linework inside the viewport at both limits', () => {
    const scene = isometricScene({ title: 'Assembly', parts });
    for (const amount of [0, 0.5, 1]) {
      const drawings = scene.draw(amount);
      expect(drawings.map(p => p.key)).toEqual(parts.map(p => p.key));
      for (const p of drawings) {
        const paths = p.solid ? [p.solid.fill, p.solid.outline, p.solid.crease, ...p.solid.shades] : [p.line];
        for (const d of paths) {
          expect(d).not.toMatch(/NaN|Infinity/);
          const numbers = d!.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
          numbers.forEach((n) => expect(n).toBeGreaterThanOrEqual(23.8));
          numbers.forEach((n, i) => expect(n).toBeLessThanOrEqual((i % 2 ? scene.height : scene.width) - 23.8));
        }
      }
    }
  });
  it('separates only the named moving part without zooming or shifting fixed parts', () => {
    const scene = isometricScene({ title: 'Assembly', parts });
    const a = scene.draw(0), b = scene.draw(1);
    expect(a[0]).toEqual(b[0]);
    expect(a[1]!.solid!.top).not.toBe(b[1]!.solid!.top);
    expect(a[2]).toEqual(b[2]);
    expect(scene.draw(-1)).toEqual(a);
    expect(scene.draw(2)).toEqual(b);
  });
  it('fits a vertical line without division by zero', () => {
    const scene = isometricScene({ title: 'Axis', parts: [parts[3]!] });
    expect(scene.draw(0)[0]!.line).not.toMatch(/NaN|Infinity/);
  });
});

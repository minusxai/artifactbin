import { expect, it } from "vitest";
import {
  makeCloth,
  releaseCloth,
  resetCloth,
  stepCloth,
} from "../paper-physics";
it("lands immediately when reduced motion skips the falling animation", () => {
  const c = makeCloth(650, 100, 180, 210, 0, 0);
  releaseCloth(c);
  c.age = 4;
  stepCloth(c, 1 / 60);
  expect(c.settled).toBe(true);
  expect(Math.min(...c.points.map((p) => p.y))).toBeGreaterThan(800);
});
it("holds pinned paper and deforms locally at the grabbed point", () => {
  const c = makeCloth(650, 100, 180, 210, 0.08, 1),
    last = c.points.length - 1;
  const first = { ...c.points[0] };
  for (let i = 0; i < 12; i++)
    stepCloth(c, 1 / 60, { index: last, x: 850, y: 390, z: 75 });
  expect(c.points[0].x).toBeCloseTo(first.x, 1);
  expect(c.points[last].z).toBeGreaterThan(30);
  expect(c.points[last].y - first.y).toBeGreaterThan(210);
});
it("falls from its release position, settles within the floor and does not share one landing point", () => {
  const a = makeCloth(650, 100, 180, 210, -0.1, 0),
    b = makeCloth(1050, 100, 180, 210, 0.1, 4);
  releaseCloth(a);
  releaseCloth(b);
  for (let i = 0; i < 600; i++) {
    stepCloth(a, 1 / 60);
    stepCloth(b, 1 / 60);
  }
  expect(a.settled).toBe(true);
  expect(b.settled).toBe(true);
  expect(Math.max(...a.points.map((p) => p.y))).toBeLessThanOrEqual(1080);
  expect(Math.abs(a.points[0].x - b.points[0].x)).toBeGreaterThan(100);
});
it("resets positions, velocities, tears and pins after a violent pull", () => {
  const c = makeCloth(650, 100, 180, 210, 0, 2);
  for (let i = 0; i < 20; i++)
    stepCloth(c, 1 / 60, {
      index: c.points.length - 1,
      x: 1000,
      y: 500,
      z: 100,
    });
  releaseCloth(c);
  resetCloth(c);
  expect(c.pinned).toBe(true);
  expect(c.torn.size).toBe(0);
  expect(c.bonds.every((b) => !b.broken)).toBe(true);
  expect(
    c.points.every((p) => p.x === p.homeX && p.y === p.homeY && p.px === p.x),
  ).toBe(true);
});

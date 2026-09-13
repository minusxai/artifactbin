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
  expect(
    Math.min(...c.points.slice(2 * (c.columns + 1)).map((p) => p.y)),
  ).toBeGreaterThan(800);
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
it("keeps the printed body nearly inextensible and tears only across the top seam", () => {
  const c = makeCloth(650, 100, 180, 210, 0, 0);
  for (let i = 0; i < 30; i++)
    stepCloth(c, 1 / 60, {
      index: c.points.length - 1,
      x: 1000,
      y: 450,
      z: 80,
    });
  const body = c.bonds.filter(
    (b) => b.a >= 4 * (c.columns + 1) && b.b >= 4 * (c.columns + 1),
  );
  expect(body.every((b) => !b.broken)).toBe(true);
  expect(
    Math.max(
      ...body.map((b) => {
        const a = c.points[b.a],
          p = c.points[b.b];
        return Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z) / b.length;
      }),
    ),
  ).toBeLessThan(1.12);
  expect(c.torn.size).toBeGreaterThan(0);
});
it("lifts one corner into a local fold while two pins stay attached", () => {
  const c = makeCloth(650, 100, 180, 210, 0, 1),
    last = c.points.length - 1;
  for (let i = 0; i < 45; i++)
    stepCloth(c, 1 / 60, { index: last, x: 800, y: 275, z: 90 });
  expect(c.attachment).toBe("pins");
  expect(c.points[0].x).toBe(650);
  expect(c.points[c.columns].x).toBe(830);
  expect(c.points[last].z).toBeGreaterThan(c.points[last - c.columns].z + 12);
  expect(c.torn.size).toBe(0);
  expect(c.pinned).toBe(true);
});
it("perforated sheets expose a progressive seam instead of random body tears", () => {
  const c = makeCloth(650, 100, 180, 210, 0, 0);
  for (let i = 0; i < 6; i++)
    stepCloth(c, 1 / 60, { index: c.points.length - 1, x: 905, y: 370, z: 90 });
  expect(c.attachment).toBe("perforated");
  expect(c.tearProgress).toBeGreaterThan(0);
  expect(c.tearProgress).toBeLessThan(1);
  expect(c.pinned).toBe(true);
});

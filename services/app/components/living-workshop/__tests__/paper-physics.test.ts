import { floorClearance, separatePapers, PAPER_FLOOR } from "../paper-contact";
import { expect, it } from "vitest";
import {
  makeCloth,
  releaseCloth,
  stepCloth,
} from "../paper-physics";
it("does not switch to a target pose when an animation timer expires", () => {
  const c = makeCloth(650, 100, 180, 210, 0, 0);
  releaseCloth(c);
  c.age = 1.46;
  const before = c.points.map((p) => ({ ...p }));
  stepCloth(c, 1 / 60);
  expect(
    Math.max(
      ...c.points.map((p, i) =>
        Math.hypot(p.x - before[i].x, p.y - before[i].y, p.z - before[i].z),
      ),
    ),
  ).toBeLessThan(5);
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

it("keeps two resting sheets separated where their surfaces overlap", () => {
  const a = makeCloth(650, 100, 180, 210, 0, 1),
    b = makeCloth(650, 100, 180, 210, 0, 2);
  releaseCloth(a);
  releaseCloth(b);
  for (const c of [a, b])
    c.points.forEach((p, i) => {
      p.x = 650 + (i % (c.columns + 1)) * 10;
      p.z = 80 + Math.floor(i / (c.columns + 1)) * 9;
      p.y = PAPER_FLOOR.y + PAPER_FLOOR.slope * p.z;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
    });
  separatePapers([a, b]);
  expect(Math.min(...b.points.map((p) => floorClearance(p)))).toBeGreaterThan(
    1,
  );
});

it("bottom-right paper tears at its punched header and retains the pinned strip", () => {
  const c = makeCloth(1159, 361, 164, 174, 0.1, 5);
  expect(c.attachment).toBe("perforated");
  releaseCloth(c);
  stepCloth(c, 1 / 60);
  expect(c.points[0].x).toBe(c.points[0].homeX);
  expect(c.torn.size).toBeGreaterThan(0);
});

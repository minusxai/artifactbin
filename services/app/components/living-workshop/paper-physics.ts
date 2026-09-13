/** Stiff paper: developable cylindrical bending with a progressive top seam.
 * Rendering consumes positions; this module owns grabbing, tearing and falling.
 */
export interface Particle {
  x: number;
  y: number;
  z: number;
  px: number;
  py: number;
  pz: number;
  homeX: number;
  homeY: number;
  homeZ: number;
}
export interface Bond {
  a: number;
  b: number;
  length: number;
  broken: boolean;
  tearable: boolean;
}
export interface Cloth {
  points: Particle[];
  bonds: Bond[];
  columns: number;
  rows: number;
  pinned: boolean;
  torn: Set<number>;
  settled: boolean;
  age: number;
  floor: number;
  drift: number;
  landingX: number;
  width: number;
  height: number;
  seed: number;
  tearProgress: number;
  tearFromRight: boolean;
  angle: number;
  offsetX: number;
  offsetY: number;
}
const COLS = 18,
  ROWS = 22;
export function makeCloth(
  x: number,
  y: number,
  width: number,
  height: number,
  angle: number,
  seed: number,
): Cloth {
  const points: Particle[] = [],
    bonds: Bond[] = [];
  for (let row = 0; row <= ROWS; row++)
    for (let col = 0; col <= COLS; col++) {
      const u = (col / COLS) * width,
        v = (row / ROWS) * height;
      let px = x + u * Math.cos(angle) - v * Math.sin(angle),
        py = y + u * Math.sin(angle) + v * Math.cos(angle);
      let z =
        12 +
        Math.sin((u / width) * Math.PI) * 2 +
        Math.max(0, v / height - 0.72) * Math.sin(seed + 1) * 12;
      // Two prints have a real lifted dog-ear, not just a triangle painted on.
      if (seed === 2 || seed === 5) {
        const fold = Math.max(0, u + v - (width + height - 24));
        px -= fold * 0.38 * (Math.cos(angle) - Math.sin(angle));
        py -= fold * 0.38 * (Math.sin(angle) + Math.cos(angle));
        z += fold * 0.72;
      }
      points.push({
        x: px,
        y: py,
        z,
        px,
        py,
        pz: z,
        homeX: px,
        homeY: py,
        homeZ: z,
      });
    }
  const link = (a: number, b: number, tearable: boolean) => {
    const p = points[a],
      q = points[b];
    bonds.push({
      a,
      b,
      length: Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z),
      broken: false,
      tearable,
    });
  };
  for (let r = 0; r <= ROWS; r++)
    for (let c = 0; c <= COLS; c++) {
      const i = r * (COLS + 1) + c;
      if (c < COLS) link(i, i + 1, true);
      if (r < ROWS) link(i, i + COLS + 1, true);
      if (r < ROWS && c < COLS) link(i, i + COLS + 2, false);
      if (r < ROWS && c > 0) link(i, i + COLS, false);
      if (c < COLS - 1) link(i, i + 2, false);
      if (r < ROWS - 1) link(i, i + 2 * (COLS + 1), false);
    }
  return {
    points,
    bonds,
    columns: COLS,
    rows: ROWS,
    pinned: true,
    torn: new Set(),
    settled: false,
    age: 0,
    floor: 936 + ((seed * 29) % 116),
    drift: (seed % 2 ? 1 : -1) * (12 + seed * 4),
    landingX: x + width / 2,
    width,
    height,
    seed,
    tearProgress: 0,
    tearFromRight: false,
    angle,
    offsetX: 0,
    offsetY: 0,
  };
}
function tearSeam(c: Cloth, progress: number) {
  c.tearProgress = Math.max(c.tearProgress, progress);
  c.bonds.forEach((b, i) => {
    const ra = Math.floor(b.a / (c.columns + 1)),
      rb = Math.floor(b.b / (c.columns + 1));
    const col = (b.a % (c.columns + 1)) / c.columns;
    if (
      Math.min(ra, rb) <= 1 &&
      Math.max(ra, rb) >= 2 &&
      (c.tearFromRight ? 1 - col : col) <= c.tearProgress
    ) {
      b.broken = true;
      c.torn.add(i);
    }
  });
}
export function releaseCloth(c: Cloth) {
  tearSeam(c, 1);
  if (!c.pinned) return;
  c.pinned = false;
  c.age = 0;
  c.settled = false;
  c.landingX = Math.max(
    440,
    Math.min(1260, c.points.reduce((s, p) => s + p.x, 0) / c.points.length),
  );
  for (const p of c.points) {
    p.px = p.x - Math.max(-9, Math.min(9, p.x - p.px));
    p.py = p.y - Math.max(-8, Math.min(8, p.y - p.py));
  }
}
export function resetCloth(c: Cloth) {
  c.pinned = true;
  c.settled = false;
  c.age = 0;
  c.torn.clear();
  c.tearProgress = 0;
  c.offsetX = 0;
  c.offsetY = 0;
  for (const b of c.bonds) b.broken = false;
  for (const p of c.points) {
    p.x = p.px = p.homeX;
    p.y = p.py = p.homeY;
    p.z = p.pz = p.homeZ;
  }
}
export function stepCloth(
  c: Cloth,
  dt: number,
  grab?: { index: number; x: number; y: number; z: number },
) {
  if (c.settled && !grab) return;
  const step = Math.min(dt, 1 / 30);
  if (!c.pinned) c.age += step;
  if (grab) {
    const origin = c.points[grab.index],
      dx = grab.x - origin.homeX,
      dy = grab.y - origin.homeY;
    const pull = Math.hypot(dx, dy);
    if (c.tearProgress === 0)
      c.tearFromRight = grab.index % (c.columns + 1) > c.columns / 2;
    if (c.pinned && pull > 28) {
      tearSeam(c, Math.min(1, (pull - 28) / 95));
      if (c.tearProgress >= 1) releaseCloth(c);
    }
    // A cylinder bends the print without stretching its surface. The pinned
    // margin stays on the board; only the short seam opens progressively.
    const amount = Math.min(0.55, pull / 200),
      radius = c.height / Math.max(0.001, amount);
    const gripV =
      (Math.floor(grab.index / (c.columns + 1)) / c.rows) * c.height;
    const shiftV = Math.sin(gripV / radius) * radius - gripV;
    c.offsetX = dx + Math.sin(c.angle) * shiftV;
    c.offsetY = dy - Math.cos(c.angle) * shiftV;
    const follow = c.pinned ? Math.min(0.65, c.tearProgress + 0.12) : 1;
    c.points.forEach((p, i) => {
      if (i < 2 * (c.columns + 1)) return;
      const v = (Math.floor(i / (c.columns + 1)) / c.rows) * c.height;
      const bend = Math.sin(v / radius) * radius - v;
      p.x = p.homeX - Math.sin(c.angle) * bend + c.offsetX * follow;
      p.y = p.homeY + Math.cos(c.angle) * bend + c.offsetY * follow;
      p.z = p.homeZ + (1 - Math.cos(v / radius)) * radius + (c.pinned ? 0 : 70);
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
    });
    c.landingX = Math.max(
      440,
      Math.min(1260, c.points[0].homeX + c.width / 2 + c.offsetX),
    );
    return;
  }
  if (c.pinned) return;
  // A bounded landing plane projects the sheet onto the painted floor. Its
  // center inherits the release location, so pages never converge on a bin.
  if (!c.pinned && !grab && c.age > 1.45) {
    const ease = c.age > 3.6 ? 1 : Math.min(1, step * 5),
      angle = (c.seed % 2 ? -0.19 : 0.17) + c.seed * 0.055;
    c.points.forEach((p, i) => {
      if (i < 2 * (c.columns + 1)) return;
      const u = ((i % (c.columns + 1)) / c.columns) * c.width - c.width / 2,
        v =
          (Math.floor(i / (c.columns + 1)) / c.rows) * c.height - c.height / 2;
      const tx = Math.max(
        15,
        Math.min(
          1433,
          c.landingX + c.drift + u * Math.cos(angle) - v * Math.sin(angle),
        ),
      );
      const ty = Math.min(
        1070,
        c.floor - 44 + (u * Math.sin(angle) + v * Math.cos(angle)) * 0.35,
      );
      p.x += (tx - p.x) * ease;
      p.y += (ty - p.y) * ease;
      p.z += (90 + Math.sin(u * 0.027) * 2 - p.z) * ease;
      p.px = p.x;
      p.py = p.y;
      p.pz = p.z;
    });
    if (c.age > 3.6) c.settled = true;
    return;
  }
  // Falling paper keeps its shape, with a small, shared flutter. No independent
  // vertices can turn the sheet into fabric or explode around the grab point.
  c.points.forEach((p, i) => {
    if (i < 2 * (c.columns + 1)) return;
    const dy = (p.y - p.py) * 0.97 + 740 * step * step;
    p.py = p.y;
    p.px = p.x;
    p.pz = p.z;
    p.x += c.drift * step * 0.25;
    p.y += dy;
    p.z = 88 + Math.sin(c.age * 5 + c.seed) * 5;
  });
}

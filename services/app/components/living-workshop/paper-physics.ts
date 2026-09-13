/** Verlet sheet: structural, diagonal and bending constraints in image space.
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
      const px = x + u * Math.cos(angle) - v * Math.sin(angle),
        py = y + u * Math.sin(angle) + v * Math.cos(angle);
      const z =
        12 +
        Math.sin((u / width) * Math.PI) * 2 +
        Math.max(0, v / height - 0.72) * Math.sin(seed + 1) * 12;
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
  };
}
export function releaseCloth(c: Cloth) {
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
  // A bounded landing plane projects the sheet onto the painted floor. Its
  // center inherits the release location, so pages never converge on a bin.
  if (!c.pinned && !grab && c.age > 1.45) {
    const ease = c.age > 3.6 ? 1 : Math.min(1, step * 5),
      angle = (c.seed % 2 ? -0.19 : 0.17) + c.seed * 0.055;
    c.points.forEach((p, i) => {
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
  for (const p of c.points) {
    const vx = (p.x - p.px) * 0.965,
      vy = (p.y - p.py) * 0.965,
      vz = (p.z - p.pz) * 0.94;
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    p.x += vx + (c.pinned ? 0 : c.drift * step * 0.18);
    p.y += vy + (c.pinned ? 25 : 740) * step * step;
    p.z += vz;
    if (!c.pinned) p.z += (88 - p.z) * step * 2;
  }
  const anchors = [0, c.columns];
  for (let iteration = 0; iteration < 7; iteration++) {
    for (let bi = 0; bi < c.bonds.length; bi++) {
      const b = c.bonds[bi];
      if (b.broken) continue;
      const a = c.points[b.a],
        p = c.points[b.b],
        dx = p.x - a.x,
        dy = p.y - a.y,
        dz = p.z - a.z,
        d = Math.hypot(dx, dy, dz) || 0.001;
      if (
        grab &&
        iteration === 0 &&
        b.tearable &&
        d > b.length * 2.8 &&
        Math.hypot(a.x - grab.x, a.y - grab.y) < 65
      ) {
        b.broken = true;
        c.torn.add(bi);
        continue;
      }
      const factor = ((d - b.length) / d) * 0.48;
      a.x += dx * factor;
      a.y += dy * factor;
      a.z += dz * factor;
      p.x -= dx * factor;
      p.y -= dy * factor;
      p.z -= dz * factor;
    }
    if (c.pinned)
      for (const i of anchors) {
        const p = c.points[i];
        p.x = p.homeX;
        p.y = p.homeY;
        p.z = p.homeZ;
      }
    if (grab) {
      const p = c.points[grab.index];
      p.x = grab.x;
      p.y = grab.y;
      p.z = grab.z;
    }
  }
  // A hard tug releases the pins. Gentle drags keep a hanging sheet flexible.
  if (grab && c.pinned) {
    const p = c.points[grab.index];
    if (Math.hypot(p.x - p.homeX, p.y - p.homeY) > 155) releaseCloth(c);
  }
}

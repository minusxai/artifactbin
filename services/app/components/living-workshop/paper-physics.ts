/** Paper shell: constrained stretch, softer bending, and explicit attachments.
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
  stiffness: number;
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
  attachment: "perforated" | "pins";
  pins: [boolean, boolean];
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
  const link = (a: number, b: number, tearable: boolean, stiffness = 1) => {
    const p = points[a],
      q = points[b];
    bonds.push({
      a,
      b,
      length: Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z),
      broken: false,
      tearable,
      stiffness,
    });
  };
  for (let r = 0; r <= ROWS; r++)
    for (let c = 0; c <= COLS; c++) {
      const i = r * (COLS + 1) + c;
      if (c < COLS) link(i, i + 1, true);
      if (r < ROWS) link(i, i + COLS + 1, true);
      if (r < ROWS && c < COLS) link(i, i + COLS + 2, false);
      if (r < ROWS && c > 0) link(i, i + COLS, false);
      if (c < COLS - 1) link(i, i + 2, false, 0.24);
      if (r < ROWS - 1) link(i, i + 2 * (COLS + 1), false, 0.24);
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
    attachment: seed === 0 || seed === 3 ? "perforated" : "pins",
    pins: [true, true],
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
  if (c.attachment === "perforated") tearSeam(c, 1);
  c.pins = [false, false];
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
  c.pins = [true, true];
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
  const strip = c.attachment === "perforated" ? 2 * (c.columns + 1) : 0;
  if (grab) {
    const origin = c.points[grab.index];
    const pull = Math.hypot(grab.x - origin.homeX, grab.y - origin.homeY);
    if (c.tearProgress === 0)
      c.tearFromRight = grab.index % (c.columns + 1) > c.columns / 2;
    if (c.pinned && c.attachment === "perforated" && pull > 75) {
      tearSeam(
        c,
        Math.min(1, c.tearProgress + step * Math.min(4, (pull - 65) / 45)),
      );
      if (c.tearProgress >= 1) releaseCloth(c);
    }
    if (c.pinned && c.attachment === "pins" && pull > 210) {
      c.pins[c.tearFromRight ? 1 : 0] = false;
      if (pull > 320) releaseCloth(c);
    }
  }
  // A bounded landing plane projects the sheet onto the painted floor. Its
  // center inherits the release location, so pages never converge on a bin.
  if (!c.pinned && !grab && c.age > 1.45) {
    const ease = c.age > 3.6 ? 1 : Math.min(1, step * 5),
      angle = (c.seed % 2 ? -0.19 : 0.17) + c.seed * 0.055;
    c.points.forEach((p, i) => {
      if (i < strip) return;
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
  // Integrate inertia, then solve the surface. The grab is compliant and its
  // target is speed-limited, so pointer jumps cannot stretch or explode a sheet.
  c.points.forEach((p, i) => {
    const vx = (p.x - p.px) * 0.82,
      vy = (p.y - p.py) * 0.82,
      vz = (p.z - p.pz) * 0.78;
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    p.x += vx + (c.pinned ? 0 : c.drift * step * 0.16);
    p.y += vy + (c.pinned ? 180 : 740) * step * step;
    p.z += vz;
    if (!c.pinned && i >= strip) p.z += (85 - p.z) * step;
  });
  const fixed = (i: number) =>
    i < strip ||
    (c.pinned && ((i === 0 && c.pins[0]) || (i === c.columns && c.pins[1])));
  let target: { x: number; y: number; z: number } | undefined;
  if (grab) {
    const p = c.points[grab.index],
      dx = grab.x - p.x,
      dy = grab.y - p.y,
      dz = grab.z - p.z;
    const scale = Math.min(1, 14 / Math.max(0.01, Math.hypot(dx, dy, dz)));
    target = { x: p.x + dx * scale, y: p.y + dy * scale, z: p.z + dz * scale };
  }
  for (let iteration = 0; iteration < 32; iteration++) {
    if (grab && target && !fixed(grab.index)) {
      const p = c.points[grab.index];
      p.x += (target.x - p.x) * 0.16;
      p.y += (target.y - p.y) * 0.16;
      p.z += (target.z - p.z) * 0.16;
    }
    for (const b of c.bonds) {
      if (b.broken) continue;
      const a = c.points[b.a],
        p = c.points[b.b],
        dx = p.x - a.x,
        dy = p.y - a.y,
        dz = p.z - a.z;
      const length = Math.hypot(dx, dy, dz) || 0.001;
      const wa = fixed(b.a) ? 0 : 1,
        wb = fixed(b.b) ? 0 : 1;
      if (wa + wb === 0) continue;
      const correction =
        (((length - b.length) / length) * b.stiffness) / (wa + wb);
      a.x += dx * correction * wa;
      a.y += dy * correction * wa;
      a.z += dz * correction * wa;
      p.x -= dx * correction * wb;
      p.y -= dy * correction * wb;
      p.z -= dz * correction * wb;
    }
    c.points.forEach((p, i) => {
      if (fixed(i)) {
        p.x = p.homeX;
        p.y = p.homeY;
        p.z = p.homeZ;
      } else if (c.pinned) p.z = Math.max(12, p.z);
    });
  }
  if (!c.pinned && grab)
    c.landingX = Math.max(
      440,
      Math.min(
        1260,
        c.points.reduce((sum, p) => sum + p.x, 0) / c.points.length,
      ),
    );
}

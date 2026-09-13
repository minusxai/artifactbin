import type { Cloth, Particle } from "./paper-physics";

// One inclined floor, shared by every sheet. Positive z comes toward the viewer.
export const PAPER_FLOOR = { y: 900, slope: 0.4, thickness: 2.5 };
export const floorClearance = (p: Pick<Particle, "y" | "z">) =>
  PAPER_FLOOR.y + PAPER_FLOOR.slope * p.z - p.y;
export function contactFloor(p: Particle): boolean {
  const gap = floorClearance(p);
  if (gap > 0) return false;
  const correction = -gap / (1 + PAPER_FLOOR.slope ** 2);
  p.y -= correction;
  p.z += PAPER_FLOOR.slope * correction;
  // Inelastic normal contact with tangential friction, preserving local folds.
  const vx = p.x - p.px,
    vy = p.y - p.py,
    vz = p.z - p.pz;
  const normal = Math.max(
    0,
    (vy - PAPER_FLOOR.slope * vz) / (1 + PAPER_FLOOR.slope ** 2),
  );
  p.px = p.x - vx * 0.7;
  p.py = p.y - (vy - normal) * 0.7;
  p.pz = p.z - (vz + PAPER_FLOOR.slope * normal) * 0.7;
  return true;
}
interface Triangle {
  a: Particle;
  b: Particle;
  c: Particle;
  area: number;
}
const CELL = 24;
const bodyStart = (c: Cloth) =>
  c.attachment === "perforated" ? 2 * (c.columns + 1) : 0;
function surfaceGrid(c: Cloth) {
  const grid = new Map<string, Triangle[]>();
  const add = (ia: number, ib: number, ic: number) => {
    const a = c.points[ia],
      b = c.points[ib],
      d = c.points[ic];
    const area = (b.z - d.z) * (a.x - d.x) + (d.x - b.x) * (a.z - d.z);
    if (Math.abs(area) < 0.01) return;
    const triangle = { a, b, c: d, area };
    for (
      let x = Math.floor(Math.min(a.x, b.x, d.x) / CELL);
      x <= Math.floor(Math.max(a.x, b.x, d.x) / CELL);
      x++
    )
      for (
        let z = Math.floor(Math.min(a.z, b.z, d.z) / CELL);
        z <= Math.floor(Math.max(a.z, b.z, d.z) / CELL);
        z++
      ) {
        const key = `${x}:${z}`,
          bucket = grid.get(key);
        if (bucket) bucket.push(triangle);
        else grid.set(key, [triangle]);
      }
  };
  const start = bodyStart(c) / (c.columns + 1);
  for (let r = start; r < c.rows; r++)
    for (let col = 0; col < c.columns; col++) {
      const a = r * (c.columns + 1) + col,
        b = a + 1,
        d = a + c.columns + 2,
        e = d - 1;
      add(a, e, b);
      add(b, e, d);
    }
  return grid;
}
/** Contact against the earlier sheet's actual triangles, not its bounding box.
 * Release order keeps a stable stack; the renderer still uses opaque depth tests.
 */
export function separatePapers(sheets: Cloth[]): void {
  const stack = sheets
    .filter((c) => !c.pinned)
    .sort((a, b) => a.order - b.order);
  const surfaces: Array<ReturnType<typeof surfaceGrid>> = [];
  for (const c of stack) {
    const start = bodyStart(c);
    if (c.points.slice(start).every((p) => floorClearance(p) > 70)) continue;
    for (let i = start; i < c.points.length; i++) {
      const p = c.points[i];
      let ceiling = Infinity;
      for (const grid of surfaces)
        for (const t of grid.get(
          `${Math.floor(p.x / CELL)}:${Math.floor(p.z / CELL)}`,
        ) || []) {
          const { a, b, c: d, area } = t;
          const u =
            ((b.z - d.z) * (p.x - d.x) + (d.x - b.x) * (p.z - d.z)) / area;
          const v =
            ((d.z - a.z) * (p.x - d.x) + (a.x - d.x) * (p.z - d.z)) / area;
          if (u < -0.001 || v < -0.001 || u + v > 1.001) continue;
          ceiling = Math.min(
            ceiling,
            u * a.y + v * b.y + (1 - u - v) * d.y - PAPER_FLOOR.thickness,
          );
        }
      if (p.y > ceiling) {
        p.y = ceiling;
        p.py = Math.min(p.py, p.y);
      }
    }
    surfaces.push(surfaceGrid(c));
  }
}

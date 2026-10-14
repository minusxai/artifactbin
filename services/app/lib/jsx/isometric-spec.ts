/** Declarative geometry shared by publish validation and the figure renderer. */
export type IsoPoint = [number, number, number];
export type IsoPlanPoint = [number, number];
type Part = { key: string; tone?: 'neutral' | 'accent' | 'secondary' | 'muted'; separation?: IsoPoint };
export type IsometricPart = Part & (
  | { kind: 'slab'; x: number; y: number; z: number; width: number; depth: number; height: number; radius?: number }
  | { kind: 'cylinder'; x: number; y: number; z: number; radius: number; height: number }
  | { kind: 'prism'; points: IsoPlanPoint[]; z: number; height: number }
  | { kind: 'line'; points: IsoPoint[]; dashed?: boolean }
);
export type IsometricSpec = { parts: IsometricPart[]; title: string; width?: number; height?: number; azimuth?: number; elevation?: number; spread?: number | string };

/** Static geometry is validated once at publish; only spread may be reactive. */
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e6;
const positive = (v: unknown) => finite(v) && v > 0;
const point = (v: unknown, size: number) => Array.isArray(v) && v.length === size && v.every(finite);
export function isometricError(p: Record<string, unknown>): string | null {
  const fail = (why: string) => `Isometric ${why}.`;
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > 500) return fail('requires a short, nonempty title');
  if (!Array.isArray(p.parts) || !p.parts.length || p.parts.length > 300) return fail('requires 1–300 static parts');
  for (const key of ['width', 'height']) if (p[key] !== undefined && (!positive(p[key]) || Number(p[key]) > 4096)) return fail(`${key} must be between 0 and 4096`);
  if (p.azimuth !== undefined && (!finite(p.azimuth) || p.azimuth < 0 || p.azimuth > 360)) return fail('azimuth must be between 0 and 360 degrees');
  if (p.elevation !== undefined && (!finite(p.elevation) || p.elevation < 5 || p.elevation > 85)) return fail('elevation must be between 5 and 85 degrees');
  if (p.spread !== undefined && !(typeof p.spread === 'string' && /^\$[A-Za-z_]\w*$/.test(p.spread)) && (!finite(p.spread) || p.spread < 0 || p.spread > 1)) return fail('spread must be 0–1 or a "$name" Value binding');
  const keys = new Set();
  for (const part of p.parts) {
    if (!record(part) || typeof part.key !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(part.key) || keys.has(part.key)) return fail('parts need unique short keys');
    keys.add(part.key);
    if (part.tone !== undefined && !['neutral', 'accent', 'secondary', 'muted'].includes(String(part.tone))) return fail('part tone must be neutral, accent, secondary or muted');
    if (part.separation !== undefined && !point(part.separation, 3)) return fail('separation must be three finite coordinates');
    if (part.kind === 'line') {
      if (!Array.isArray(part.points) || part.points.length < 2 || part.points.length > 256 || !part.points.every(p => point(p, 3))) return fail('lines need 2–256 three-dimensional points');
      if (part.dashed !== undefined && typeof part.dashed !== 'boolean') return fail('dashed must be boolean');
      continue;
    }
    if (!finite(part.z) || !positive(part.height)) return fail('solids need finite z and positive height');
    if (part.kind === 'prism') {
      if (!Array.isArray(part.points) || part.points.length < 3 || part.points.length > 256 || !part.points.every(p => point(p, 2))) return fail('prisms need 3–256 two-dimensional outline points');
      const points = part.points as IsoPlanPoint[];
      const area = points.reduce((a, [x, y], i) => { const next = points[(i + 1) % points.length]!; return a + x * next[1] - next[0] * y; }, 0);
      if (Math.abs(area) < 1e-8) return fail('prism outline must enclose an area');
      continue;
    }
    if (!finite(part.x) || !finite(part.y)) return fail('solids need finite x and y');
    if (part.kind === 'slab') {
      if (!positive(part.width) || !positive(part.depth) || (part.radius !== undefined && (!finite(part.radius) || part.radius < 0))) return fail('slabs need positive width/depth and a nonnegative corner radius');
    } else if (part.kind === 'cylinder') {
      if (!positive(part.radius)) return fail('cylinders need a positive radius');
    } else return fail('part kind must be slab, cylinder, prism or line');
  }
  return null;
}
